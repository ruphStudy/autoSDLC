import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Architecture,
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
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../ai/planning/errors/planning-ai.error';
import { ArchitecturePrompt } from './prompts/architecture.prompt';
import {
  ArchitectureContent,
  ArchitectureContentSchema,
  ArchitectureFieldSchemas,
} from './schemas/architecture.schema';
import { mapPlanningErrorToHttpException } from './errors/architecture-error.mapper';
import { ArchitectureVersionSummary } from './types/architecture.types';
import { EditArchitectureDto } from './dto/edit-architecture.dto';

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

const SCHEMA_NAME = 'architecture';

// Sprint 5 deliberately does not introduce ARCHITECTING/ARCHITECTURE_READY
// project statuses (that would collide with Sprint 6's use of PLANNING/
// PLAN_READY for sprint planning). Instead, architecture generation borrows
// the existing controlled transition as a concurrency lock: the project
// moves ANALYSIS_READY -> PLANNING for the duration of the AI call and back
// to ANALYSIS_READY on completion (success or failure). PLANNING here means
// "a planning artifact is being generated", not sprint planning specifically
// — Sprint 6 introduces its own real PLAN_READY transition later.
@Injectable()
export class ArchitectureService {
  private readonly logger = new Logger(ArchitectureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  async generate(userId: string, projectId: string): Promise<Architecture> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    const analysis = await this.getLatestAnalysisOrThrow(projectId);

    const existing = await this.findLatestArchitecture(projectId);
    if (existing) {
      throw new ConflictException(
        'Architecture already exists for this project. Use regenerate instead.',
      );
    }

    return this.runGeneration(userId, project, analysis, {
      basedOnVersion: null,
    });
  }

  async regenerate(userId: string, projectId: string): Promise<Architecture> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    const analysis = await this.getLatestAnalysisOrThrow(projectId);

    const existing = await this.findLatestArchitecture(projectId);
    if (!existing) {
      throw new NotFoundException(
        'No architecture found for this project. Generate one first.',
      );
    }

    return this.runGeneration(userId, project, analysis, {
      basedOnVersion: null,
    });
  }

  async getCurrent(userId: string, projectId: string): Promise<Architecture> {
    await this.projectsService.findOneForUser(userId, projectId);
    const architecture = await this.findLatestArchitecture(projectId);
    if (!architecture) {
      throw new NotFoundException('No architecture found for this project.');
    }
    return architecture;
  }

  async listVersions(
    userId: string,
    projectId: string,
  ): Promise<ArchitectureVersionSummary[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    return this.prisma.architecture.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        basedOnVersion: true,
        projectAnalysisId: true,
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
  ): Promise<Architecture> {
    await this.projectsService.findOneForUser(userId, projectId);
    const architecture = await this.prisma.architecture.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!architecture) {
      throw new NotFoundException('Architecture version not found.');
    }
    return architecture;
  }

  async edit(
    userId: string,
    projectId: string,
    dto: EditArchitectureDto,
  ): Promise<Architecture> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);

    const current = await this.findLatestArchitecture(projectId);
    if (!current) {
      throw new NotFoundException(
        'No architecture found for this project. Generate one first.',
      );
    }

    const providedFields = this.validateProvidedFields(dto);

    const merged = {
      summary: current.summary,
      frontendArchitecture: current.frontendArchitecture,
      backendArchitecture: current.backendArchitecture,
      apiArchitecture: current.apiArchitecture,
      databaseArchitecture: current.databaseArchitecture,
      authenticationArchitecture: current.authenticationArchitecture,
      integrationArchitecture: current.integrationArchitecture,
      infrastructureArchitecture: current.infrastructureArchitecture,
      deploymentArchitecture: current.deploymentArchitecture,
      securityArchitecture: current.securityArchitecture,
      testingStrategy: current.testingStrategy,
      nonFunctionalDecisions: current.nonFunctionalDecisions,
      architectureDecisions: current.architectureDecisions,
      requirementTraceability: current.requirementTraceability,
      unresolvedQuestions: current.unresolvedQuestions,
      constraints: current.constraints,
      ...providedFields,
    };

    const full = ArchitectureContentSchema.safeParse(merged);
    if (!full.success) {
      throw new BadRequestException(
        full.error.issues.map((issue) => issue.message),
      );
    }

    const analysis = await this.prisma.projectAnalysis.findUnique({
      where: { id: current.projectAnalysisId },
    });
    if (analysis) {
      const invalidIds = this.findInvalidTraceabilityIds(full.data, analysis);
      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `requirementTraceability references unknown functional requirement ids: ${invalidIds.join(', ')}`,
        );
      }
    }

    const architecture = await this.persistNewVersion(projectId, {
      source: AnalysisSource.USER_EDITED,
      basedOnVersion: current.version,
      // Preserves original analysis lineage: an edit refines the same
      // AI-generated architecture, it doesn't re-derive from a new analysis.
      projectAnalysisId: current.projectAnalysisId,
      content: full.data,
    });

    this.logger.log(
      `Architecture edited (projectId=${projectId}, newVersion=${architecture.version})`,
    );
    return architecture;
  }

  private async runGeneration(
    userId: string,
    project: Project,
    analysis: ProjectAnalysis,
    options: { basedOnVersion: number | null },
  ): Promise<Architecture> {
    // Atomically claims the "generating" slot: if the project isn't
    // ANALYSIS_READY (already PLANNING from a concurrent request, or a
    // post-analysis/in-development state), this throws a 409 immediately —
    // no AI call is made, and no race on the version number below is
    // possible since only the request that wins this transition ever
    // reaches persistence.
    await this.projectsService.transitionStatus(
      userId,
      project.id,
      ProjectStatus.ANALYSIS_READY,
      ProjectStatus.PLANNING,
    );

    let content: ArchitectureContent;
    let aiMetadata: AIGenerationMetadata;

    try {
      const prompt = ArchitecturePrompt.build({
        projectName: project.name,
        preferredStack: project.preferredStack,
        repositoryType: project.repositoryType,
        repositoryUrl: project.repositoryUrl,
        analysis: {
          summary: analysis.summary,
          targetUsers: analysis.targetUsers,
          goals: analysis.goals,
          features: analysis.features,
          functionalRequirements: analysis.functionalRequirements,
          nonFunctionalRequirements: analysis.nonFunctionalRequirements,
          assumptions: analysis.assumptions,
          risks: analysis.risks,
          unresolvedQuestions: analysis.unresolvedQuestions,
          integrations: analysis.integrations,
        },
      });

      this.logger.log(
        `Architecture generation started (projectId=${project.id}, projectAnalysisId=${analysis.id}, prompt=${ArchitecturePrompt.name}:v${ArchitecturePrompt.version})`,
      );

      const result = await this.planningAIProvider.generateStructuredOutput({
        operation: PlanningOperation.ARCHITECTURE_GENERATION,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        schema: ArchitectureContentSchema,
        schemaName: SCHEMA_NAME,
        metadata: { projectId: project.id, projectAnalysisId: analysis.id },
      });

      const invalidIds = this.findInvalidTraceabilityIds(result.data, analysis);
      if (invalidIds.length > 0) {
        throw new PlanningAIError({
          code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
          message: `Architecture referenced unknown functional requirement ids: ${invalidIds.join(', ')}`,
          provider: result.metadata.provider,
          retryable: false,
        });
      }
      this.warnIfRequirementsUncovered(result.data, analysis, project.id);

      content = result.data;
      aiMetadata = {
        promptName: ArchitecturePrompt.name,
        promptVersion: ArchitecturePrompt.version,
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
        `Architecture generation completed (projectId=${project.id}, attempts=${aiMetadata.attempts}, latencyMs=${aiMetadata.latencyMs})`,
      );
    } catch (rawError) {
      await this.restoreStatusAfterFailure(userId, project.id);
      if (rawError instanceof PlanningAIError) {
        this.logger.warn(
          `Architecture generation failed (projectId=${project.id}, code=${rawError.code})`,
        );
        throw mapPlanningErrorToHttpException(rawError);
      }
      this.logger.warn(
        `Architecture generation failed (projectId=${project.id}, code=UNKNOWN)`,
      );
      throw rawError;
    }

    try {
      return await this.persistNewVersion(project.id, {
        source: AnalysisSource.AI_GENERATED,
        basedOnVersion: options.basedOnVersion,
        projectAnalysisId: analysis.id,
        content,
        aiMetadata,
      });
    } catch (persistError) {
      await this.restoreStatusAfterFailure(userId, project.id);
      throw persistError;
    }
  }

  private async findLatestArchitecture(
    projectId: string,
  ): Promise<Architecture | null> {
    return this.prisma.architecture.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
  }

  private async getLatestAnalysisOrThrow(
    projectId: string,
  ): Promise<ProjectAnalysis> {
    const analysis = await this.prisma.projectAnalysis.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!analysis) {
      throw new ConflictException(
        'Project Analysis must be generated before Architecture.',
      );
    }
    return analysis;
  }

  private functionalRequirementIds(analysis: ProjectAnalysis): Set<string> {
    const requirements = analysis.functionalRequirements as unknown as Array<{
      id: string;
    }>;
    return new Set(requirements.map((requirement) => requirement.id));
  }

  private findInvalidTraceabilityIds(
    content: Pick<ArchitectureContent, 'requirementTraceability'>,
    analysis: ProjectAnalysis,
  ): string[] {
    const validIds = this.functionalRequirementIds(analysis);
    const invalid = content.requirementTraceability
      .map((item) => item.requirementId)
      .filter((id) => !validIds.has(id));
    return Array.from(new Set(invalid));
  }

  // Non-blocking: a strong warning is preferred over a hard rejection, since
  // a requirement can legitimately have no distinct architectural footprint.
  private warnIfRequirementsUncovered(
    content: Pick<ArchitectureContent, 'requirementTraceability'>,
    analysis: ProjectAnalysis,
    projectId: string,
  ): void {
    const validIds = this.functionalRequirementIds(analysis);
    const covered = new Set(
      content.requirementTraceability.map((item) => item.requirementId),
    );
    const uncovered = Array.from(validIds).filter((id) => !covered.has(id));
    if (uncovered.length > 0) {
      this.logger.warn(
        `Architecture has no traceability entry for functional requirements: ${uncovered.join(', ')} (projectId=${projectId})`,
      );
    }
  }

  // Validates only the keys the caller actually sent (each against its own
  // canonical field schema), so an omitted section is left `undefined` here
  // and never overwrites `current` in the merge above with an empty default
  // (the Sprint 4 partial-edit array-wipe bug this deliberately avoids).
  private validateProvidedFields(
    dto: EditArchitectureDto,
  ): Partial<ArchitectureContent> {
    const result: Partial<Record<string, unknown>> = {};
    const messages: string[] = [];

    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) {
        continue;
      }
      const fieldSchema =
        ArchitectureFieldSchemas[key as keyof typeof ArchitectureFieldSchemas];
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

    return result as Partial<ArchitectureContent>;
  }

  private async persistNewVersion(
    projectId: string,
    data: {
      source: AnalysisSource;
      basedOnVersion: number | null;
      projectAnalysisId: string;
      content: ArchitectureContent;
      aiMetadata?: AIGenerationMetadata;
    },
  ): Promise<Architecture> {
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.architecture.aggregate({
        where: { projectId },
        _max: { version: true },
      });
      const nextVersion = (aggregate._max.version ?? 0) + 1;

      const architecture = await tx.architecture.create({
        data: {
          projectId,
          projectAnalysisId: data.projectAnalysisId,
          version: nextVersion,
          source: data.source,
          basedOnVersion: data.basedOnVersion,
          summary: data.content.summary,
          frontendArchitecture: data.content.frontendArchitecture,
          backendArchitecture: data.content.backendArchitecture,
          apiArchitecture: data.content.apiArchitecture,
          databaseArchitecture: data.content.databaseArchitecture,
          authenticationArchitecture: data.content.authenticationArchitecture,
          integrationArchitecture: data.content.integrationArchitecture,
          infrastructureArchitecture: data.content.infrastructureArchitecture,
          deploymentArchitecture: data.content.deploymentArchitecture,
          securityArchitecture: data.content.securityArchitecture,
          testingStrategy: data.content.testingStrategy,
          nonFunctionalDecisions: data.content.nonFunctionalDecisions,
          architectureDecisions: data.content.architectureDecisions,
          requirementTraceability: data.content.requirementTraceability,
          unresolvedQuestions: data.content.unresolvedQuestions,
          constraints: data.content.constraints,
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

      return architecture;
    });
  }

  private async restoreStatusAfterFailure(
    userId: string,
    projectId: string,
  ): Promise<void> {
    try {
      await this.projectsService.transitionStatus(
        userId,
        projectId,
        ProjectStatus.PLANNING,
        ProjectStatus.ANALYSIS_READY,
      );
    } catch (compensationError) {
      // The one situation we must never allow silently: a project stuck in
      // PLANNING forever. Log loudly so this is never a quiet failure.
      this.logger.error(
        `Failed to restore project status after architecture generation failure (projectId=${projectId})`,
        compensationError instanceof Error
          ? compensationError.stack
          : undefined,
      );
    }
  }

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot modify architecture for an archived project. Restore the project first.',
      );
    }
  }
}
