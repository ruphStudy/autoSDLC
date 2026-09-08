import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalysisSource,
  Project,
  ProjectAnalysis,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import {
  PLANNING_AI_PROVIDER,
  PlanningOperation,
} from '../ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../ai/planning/contracts/planning-provider.interface';
import { PlanningAIError } from '../ai/planning/errors/planning-ai.error';
import { ProjectAnalysisPrompt } from './prompts/project-analysis.prompt';
import {
  ProjectAnalysisContent,
  ProjectAnalysisContentSchema,
  ProjectAnalysisFieldSchemas,
} from './schemas/project-analysis.schema';
import { mapPlanningErrorToHttpException } from './errors/analysis-error.mapper';
import { ProjectAnalysisVersionSummary } from './types/project-analysis.types';
import { EditProjectAnalysisDto } from './dto/edit-project-analysis.dto';

interface AIGenerationMetadata {
  promptName: string;
  promptVersion: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  attempts: number;
  providerRequestId?: string;
}

const SCHEMA_NAME = 'project_analysis';

@Injectable()
export class ProjectAnalysisService {
  private readonly logger = new Logger(ProjectAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  async generate(userId: string, projectId: string): Promise<ProjectAnalysis> {
    return this.runGeneration(
      userId,
      projectId,
      ProjectStatus.DRAFT,
      ProjectStatus.DRAFT,
    );
  }

  async regenerate(
    userId: string,
    projectId: string,
  ): Promise<ProjectAnalysis> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const allowedEntry: ProjectStatus[] = [
      ProjectStatus.ANALYSIS_READY,
      ProjectStatus.ANALYSIS_APPROVED,
    ];
    if (!allowedEntry.includes(project.status)) {
      throw new ConflictException(
        `Project status is ${project.status}, expected one of ${allowedEntry.join(', ')}`,
      );
    }

    // Regenerating an already-approved analysis creates a new, unapproved
    // current version — a failed attempt, however, changes nothing, so it
    // must restore to whichever status the project actually started in.
    return this.runGeneration(
      userId,
      projectId,
      project.status,
      project.status,
    );
  }

  async getCurrent(
    userId: string,
    projectId: string,
  ): Promise<ProjectAnalysis> {
    await this.projectsService.findOneForUser(userId, projectId);
    const analysis = await this.prisma.projectAnalysis.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!analysis) {
      throw new NotFoundException('No analysis found for this project.');
    }
    return analysis;
  }

  async listVersions(
    userId: string,
    projectId: string,
  ): Promise<ProjectAnalysisVersionSummary[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    return this.prisma.projectAnalysis.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        basedOnVersion: true,
        promptVersion: true,
        provider: true,
        model: true,
        createdAt: true,
      },
    });
  }

  async getVersion(
    userId: string,
    projectId: string,
    version: number,
  ): Promise<ProjectAnalysis> {
    await this.projectsService.findOneForUser(userId, projectId);
    const analysis = await this.prisma.projectAnalysis.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!analysis) {
      throw new NotFoundException('Analysis version not found.');
    }
    return analysis;
  }

  async edit(
    userId: string,
    projectId: string,
    dto: EditProjectAnalysisDto,
  ): Promise<ProjectAnalysis> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);

    const current = await this.prisma.projectAnalysis.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!current) {
      throw new NotFoundException(
        'No analysis found for this project. Generate one first.',
      );
    }

    const providedFields = this.validateProvidedFields(dto);

    const merged = {
      summary: current.summary,
      targetUsers: current.targetUsers,
      goals: current.goals,
      features: current.features,
      functionalRequirements: current.functionalRequirements,
      nonFunctionalRequirements: current.nonFunctionalRequirements,
      assumptions: current.assumptions,
      risks: current.risks,
      unresolvedQuestions: current.unresolvedQuestions,
      integrations: current.integrations,
      ...providedFields,
    };

    // Re-validate the full merged shape, not just the patch: catches a
    // patch that's individually valid but produces an inconsistent whole
    // (e.g. a duplicate functional requirement id against the untouched
    // remainder of the array).
    const full = ProjectAnalysisContentSchema.safeParse(merged);
    if (!full.success) {
      throw new BadRequestException(
        full.error.issues.map((issue) => issue.message),
      );
    }

    const analysis = await this.persistNewVersion(projectId, {
      source: AnalysisSource.USER_EDITED,
      basedOnVersion: current.version,
      content: full.data,
    });

    this.logger.log(
      `Project analysis edited (projectId=${projectId}, newVersion=${analysis.version})`,
    );
    return analysis;
  }

  private async runGeneration(
    userId: string,
    projectId: string,
    expectedStatus: ProjectStatus,
    failureStatus: ProjectStatus,
  ): Promise<ProjectAnalysis> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);

    // Atomically claims the "generating" slot: if the project isn't in
    // `expectedStatus` (already ANALYZING from a concurrent request, or
    // simply the wrong state), this throws a 409 immediately — no AI call
    // is made, and no race on the version number below is possible since
    // only the request that wins this transition ever reaches persistence.
    await this.projectsService.transitionStatus(
      userId,
      projectId,
      expectedStatus,
      ProjectStatus.ANALYZING,
    );

    let content: ProjectAnalysisContent;
    let aiMetadata: AIGenerationMetadata;

    try {
      const prompt = ProjectAnalysisPrompt.build({
        projectName: project.name,
        brief: project.brief,
        description: project.description,
        preferredStack: project.preferredStack,
        repositoryType: project.repositoryType,
        repositoryUrl: project.repositoryUrl,
      });

      this.logger.log(
        `Project analysis started (projectId=${projectId}, prompt=${ProjectAnalysisPrompt.name}:v${ProjectAnalysisPrompt.version})`,
      );

      const result = await this.planningAIProvider.generateStructuredOutput({
        operation: PlanningOperation.PROJECT_ANALYSIS,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        schema: ProjectAnalysisContentSchema,
        schemaName: SCHEMA_NAME,
        metadata: { projectId },
      });

      content = result.data;
      aiMetadata = {
        promptName: ProjectAnalysisPrompt.name,
        promptVersion: ProjectAnalysisPrompt.version,
        provider: result.metadata.provider,
        model: result.metadata.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        latencyMs: result.metadata.latencyMs,
        attempts: result.metadata.attempts,
        providerRequestId: result.metadata.requestId,
      };

      this.logger.log(
        `Project analysis completed (projectId=${projectId}, attempts=${aiMetadata.attempts}, latencyMs=${aiMetadata.latencyMs})`,
      );
    } catch (rawError) {
      await this.restoreStatusAfterFailure(userId, projectId, failureStatus);
      if (rawError instanceof PlanningAIError) {
        this.logger.warn(
          `Project analysis failed (projectId=${projectId}, code=${rawError.code})`,
        );
        throw mapPlanningErrorToHttpException(rawError);
      }
      this.logger.warn(
        `Project analysis failed (projectId=${projectId}, code=UNKNOWN)`,
      );
      throw rawError;
    }

    try {
      return await this.persistNewVersion(projectId, {
        source: AnalysisSource.AI_GENERATED,
        basedOnVersion: null,
        content,
        aiMetadata,
      });
    } catch (persistError) {
      await this.restoreStatusAfterFailure(userId, projectId, failureStatus);
      throw persistError;
    }
  }

  // Validates only the keys the caller actually sent (each against its own
  // canonical field schema), so an omitted section is left `undefined` here
  // and never overwrites `current` in the merge above with an empty default.
  private validateProvidedFields(
    dto: EditProjectAnalysisDto,
  ): Partial<ProjectAnalysisContent> {
    const result: Partial<Record<string, unknown>> = {};
    const messages: string[] = [];

    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) {
        continue;
      }
      const fieldSchema =
        ProjectAnalysisFieldSchemas[
          key as keyof typeof ProjectAnalysisFieldSchemas
        ];
      if (!fieldSchema) {
        continue;
      }
      const parsed = fieldSchema.safeParse(value);
      if (!parsed.success) {
        messages.push(
          ...parsed.error.issues.map((issue) => `${key}: ${issue.message}`),
        );
        continue;
      }
      result[key] = parsed.data;
    }

    if (messages.length > 0) {
      throw new BadRequestException(messages);
    }

    return result as Partial<ProjectAnalysisContent>;
  }

  private async persistNewVersion(
    projectId: string,
    data: {
      source: AnalysisSource;
      basedOnVersion: number | null;
      content: ProjectAnalysisContent;
      aiMetadata?: AIGenerationMetadata;
    },
  ): Promise<ProjectAnalysis> {
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.projectAnalysis.aggregate({
        where: { projectId },
        _max: { version: true },
      });
      const nextVersion = (aggregate._max.version ?? 0) + 1;

      const analysis = await tx.projectAnalysis.create({
        data: {
          projectId,
          version: nextVersion,
          source: data.source,
          basedOnVersion: data.basedOnVersion,
          summary: data.content.summary,
          targetUsers: data.content.targetUsers,
          goals: data.content.goals,
          features: data.content.features,
          functionalRequirements: data.content.functionalRequirements,
          nonFunctionalRequirements: data.content.nonFunctionalRequirements,
          assumptions: data.content.assumptions,
          risks: data.content.risks,
          unresolvedQuestions: data.content.unresolvedQuestions,
          integrations: data.content.integrations,
          promptName: data.aiMetadata?.promptName ?? null,
          promptVersion: data.aiMetadata?.promptVersion ?? null,
          provider: data.aiMetadata?.provider ?? null,
          model: data.aiMetadata?.model ?? null,
          inputTokens: data.aiMetadata?.inputTokens ?? null,
          outputTokens: data.aiMetadata?.outputTokens ?? null,
          totalTokens: data.aiMetadata?.totalTokens ?? null,
          latencyMs: data.aiMetadata?.latencyMs ?? null,
          attempts: data.aiMetadata?.attempts ?? null,
          providerRequestId: data.aiMetadata?.providerRequestId ?? null,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.ANALYSIS_READY },
      });

      return analysis;
    });
  }

  private async restoreStatusAfterFailure(
    userId: string,
    projectId: string,
    target: ProjectStatus,
  ): Promise<void> {
    try {
      await this.projectsService.transitionStatus(
        userId,
        projectId,
        ProjectStatus.ANALYZING,
        target,
      );
    } catch (compensationError) {
      // The one situation we must never allow silently: a project stuck in
      // ANALYZING forever. Log loudly so this is never a quiet failure.
      this.logger.error(
        `Failed to restore project status after analysis failure (projectId=${projectId}, target=${target})`,
        compensationError instanceof Error
          ? compensationError.stack
          : undefined,
      );
    }
  }

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot modify analysis for an archived project. Restore the project first.',
      );
    }
  }
}
