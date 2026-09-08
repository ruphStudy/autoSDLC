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
  Architecture,
  Project,
  ProjectAnalysis,
  ProjectStatus,
  SprintPlan,
  SprintStatus,
  TaskStatus,
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
import { SprintPlanningPrompt } from './prompts/sprint-planning.prompt';
import {
  SprintPlanContent,
  SprintPlanContentSchema,
} from './schemas/sprint-plan.schema';
import { mapPlanningErrorToHttpException } from './errors/sprint-plan-error.mapper';
import {
  SprintPlanGraph,
  SprintPlanVersionSummary,
} from './types/sprint-plan.types';
import { EditSprintPlanDto } from './dto/edit-sprint-plan.dto';
import { ApprovalService } from '../approval/approval.service';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';
import { mapApprovalErrorToHttpException } from '../approval/errors/approval-error.mapper';

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

const SCHEMA_NAME = 'sprint_plan';
const PRE_DEVELOPMENT_BLOCKED_STATUSES: ProjectStatus[] = [
  ProjectStatus.DEVELOPING,
  ProjectStatus.TESTING,
  ProjectStatus.COMPLETED,
];

// Reuses the exact ANALYSIS_READY <-> PLANNING <-> ANALYSIS_READY concurrency
// pattern Sprint 5 established for Architecture, one level up: initial
// generation is ANALYSIS_READY -> PLANNING -> PLAN_READY, and regeneration is
// PLAN_READY -> PLANNING -> PLAN_READY. This is the first sprint where
// PLAN_READY becomes a real, meaningful status.
@Injectable()
export class SprintPlanningService {
  private readonly logger = new Logger(SprintPlanningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  async generate(userId: string, projectId: string): Promise<SprintPlanGraph> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    const architecture = await this.getLatestArchitectureOrThrow(projectId);
    await this.assertArchitectureApproved(projectId);

    const existing = await this.findLatestSprintPlan(projectId);
    if (existing) {
      throw new ConflictException(
        'A sprint plan already exists for this project. Use regenerate instead.',
      );
    }

    const sprintPlan = await this.runGeneration(userId, project, architecture, {
      expectedStatus: ProjectStatus.ARCHITECTURE_APPROVED,
      basedOnVersion: null,
    });
    return this.hydrate(sprintPlan.id);
  }

  async regenerate(
    userId: string,
    projectId: string,
  ): Promise<SprintPlanGraph> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    const architecture = await this.getLatestArchitectureOrThrow(projectId);
    await this.assertArchitectureApproved(projectId);

    const existing = await this.findLatestSprintPlan(projectId);
    if (!existing) {
      throw new NotFoundException(
        'No sprint plan found for this project. Generate one first.',
      );
    }

    const allowedEntry: ProjectStatus[] = [
      ProjectStatus.PLAN_READY,
      ProjectStatus.PLAN_APPROVED,
    ];
    if (!allowedEntry.includes(project.status)) {
      throw new ConflictException(
        `Project status is ${project.status}, expected one of ${allowedEntry.join(', ')}`,
      );
    }

    const sprintPlan = await this.runGeneration(userId, project, architecture, {
      expectedStatus: project.status,
      basedOnVersion: null,
    });
    return this.hydrate(sprintPlan.id);
  }

  // Generation gate for both first-time generation and regeneration: a
  // Sprint Plan may only be (re)generated from the *current* Architecture
  // version once a human has approved it. Checked directly against the
  // Approval table, not merely inferred from ProjectStatus.
  private async assertArchitectureApproved(projectId: string): Promise<void> {
    const approved =
      await this.approvalService.isCurrentArchitectureApproved(projectId);
    if (!approved) {
      throw mapApprovalErrorToHttpException(
        new ApprovalError({
          code: ApprovalErrorCode.STAGE_NOT_READY,
          message:
            'Current Architecture must be approved before Sprint Planning can be generated.',
        }),
      );
    }
  }

  async getCurrent(
    userId: string,
    projectId: string,
  ): Promise<SprintPlanGraph> {
    await this.projectsService.findOneForUser(userId, projectId);
    const sprintPlan = await this.findLatestSprintPlan(projectId);
    if (!sprintPlan) {
      throw new NotFoundException('No sprint plan found for this project.');
    }
    return this.hydrate(sprintPlan.id);
  }

  async listVersions(
    userId: string,
    projectId: string,
  ): Promise<SprintPlanVersionSummary[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    return this.prisma.sprintPlan.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        basedOnVersion: true,
        architectureId: true,
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
  ): Promise<SprintPlanGraph> {
    await this.projectsService.findOneForUser(userId, projectId);
    const sprintPlan = await this.prisma.sprintPlan.findUnique({
      where: { projectId_version: { projectId, version } },
    });
    if (!sprintPlan) {
      throw new NotFoundException('Sprint plan version not found.');
    }
    return this.hydrate(sprintPlan.id);
  }

  async edit(
    userId: string,
    projectId: string,
    dto: EditSprintPlanDto,
  ): Promise<SprintPlanGraph> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    this.assertPreDevelopment(project);

    const current = await this.findLatestSprintPlan(projectId);
    if (!current) {
      throw new NotFoundException(
        'No sprint plan found for this project. Generate one first.',
      );
    }

    const parsed = SprintPlanContentSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => issue.message),
      );
    }

    const analysis = await this.resolveAnalysisForArchitecture(
      current.architectureId,
    );
    const coverage = this.checkRequirementCoverage(parsed.data, analysis);
    if (coverage.unknownIds.length > 0 || coverage.uncoveredIds.length > 0) {
      throw new BadRequestException(this.coverageMessages(coverage));
    }

    const sprintPlan = await this.persistNewVersion(projectId, {
      architectureId: current.architectureId,
      source: AnalysisSource.USER_EDITED,
      basedOnVersion: current.version,
      content: parsed.data,
    });

    this.logger.log(
      `Sprint plan edited (projectId=${projectId}, newVersion=${sprintPlan.version})`,
    );
    return this.hydrate(sprintPlan.id);
  }

  private async runGeneration(
    userId: string,
    project: Project,
    architecture: Architecture,
    options: { expectedStatus: ProjectStatus; basedOnVersion: number | null },
  ): Promise<SprintPlan> {
    // Atomically claims the "generating" slot: if the project isn't in
    // `expectedStatus`, this throws a 409 immediately — no AI call is made,
    // and no race on the version number below is possible since only the
    // request that wins this transition ever reaches persistence.
    await this.projectsService.transitionStatus(
      userId,
      project.id,
      options.expectedStatus,
      ProjectStatus.PLANNING,
    );

    const analysis = await this.resolveAnalysisForArchitecture(architecture.id);

    let content: SprintPlanContent;
    let aiMetadata: AIGenerationMetadata;

    try {
      const prompt = SprintPlanningPrompt.build({
        projectName: project.name,
        preferredStack: project.preferredStack,
        repositoryType: project.repositoryType,
        architecture: {
          summary: architecture.summary,
          frontendArchitecture: architecture.frontendArchitecture,
          backendArchitecture: architecture.backendArchitecture,
          apiArchitecture: architecture.apiArchitecture,
          databaseArchitecture: architecture.databaseArchitecture,
          authenticationArchitecture: architecture.authenticationArchitecture,
          integrationArchitecture: architecture.integrationArchitecture,
          securityArchitecture: architecture.securityArchitecture,
          testingStrategy: architecture.testingStrategy,
          architectureDecisions: architecture.architectureDecisions,
          nonFunctionalDecisions: architecture.nonFunctionalDecisions,
          constraints: architecture.constraints,
        },
        analysis: {
          features: analysis.features,
          functionalRequirements: analysis.functionalRequirements,
          nonFunctionalRequirements: analysis.nonFunctionalRequirements,
          risks: analysis.risks,
          integrations: analysis.integrations,
        },
      });

      this.logger.log(
        `Sprint plan generation started (projectId=${project.id}, architectureId=${architecture.id}, prompt=${SprintPlanningPrompt.name}:v${SprintPlanningPrompt.version})`,
      );

      const result = await this.planningAIProvider.generateStructuredOutput({
        operation: PlanningOperation.SPRINT_PLANNING,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        schema: SprintPlanContentSchema,
        schemaName: SCHEMA_NAME,
        metadata: { projectId: project.id, architectureId: architecture.id },
      });

      const coverage = this.checkRequirementCoverage(result.data, analysis);
      if (coverage.unknownIds.length > 0 || coverage.uncoveredIds.length > 0) {
        throw new PlanningAIError({
          code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
          message: `Sprint plan requirement coverage invalid: ${this.coverageMessages(coverage).join('; ')}`,
          provider: result.metadata.provider,
          retryable: false,
        });
      }

      content = result.data;
      aiMetadata = {
        promptName: SprintPlanningPrompt.name,
        promptVersion: SprintPlanningPrompt.version,
        provider: result.metadata.provider,
        model: result.metadata.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        latencyMs: result.metadata.latencyMs,
        attempts: result.metadata.attempts,
        providerRequestId: result.metadata.requestId,
      };

      const taskCount = content.sprints.reduce(
        (sum, sprint) => sum + sprint.tasks.length,
        0,
      );
      this.logger.log(
        `Sprint plan generation completed (projectId=${project.id}, sprints=${content.sprints.length}, tasks=${taskCount}, attempts=${aiMetadata.attempts}, latencyMs=${aiMetadata.latencyMs})`,
      );
    } catch (rawError) {
      await this.restoreStatusAfterFailure(
        userId,
        project.id,
        options.expectedStatus,
      );
      if (rawError instanceof PlanningAIError) {
        this.logger.warn(
          `Sprint plan generation failed (projectId=${project.id}, code=${rawError.code})`,
        );
        throw mapPlanningErrorToHttpException(rawError);
      }
      this.logger.warn(
        `Sprint plan generation failed (projectId=${project.id}, code=UNKNOWN)`,
      );
      throw rawError;
    }

    try {
      return await this.persistNewVersion(project.id, {
        architectureId: architecture.id,
        source: AnalysisSource.AI_GENERATED,
        basedOnVersion: options.basedOnVersion,
        content,
        aiMetadata,
      });
    } catch (persistError) {
      await this.restoreStatusAfterFailure(
        userId,
        project.id,
        options.expectedStatus,
      );
      throw persistError;
    }
  }

  private checkRequirementCoverage(
    content: SprintPlanContent,
    analysis: ProjectAnalysis,
  ): { unknownIds: string[]; uncoveredIds: string[] } {
    const validIds = new Set(
      (analysis.functionalRequirements as unknown as Array<{ id: string }>).map(
        (fr) => fr.id,
      ),
    );
    const referencedIds = new Set(
      content.sprints.flatMap((sprint) =>
        sprint.tasks.flatMap((task) => task.requirementIds),
      ),
    );

    const unknownIds = Array.from(referencedIds).filter(
      (id) => !validIds.has(id),
    );
    const uncoveredIds = Array.from(validIds).filter(
      (id) => !referencedIds.has(id),
    );
    return { unknownIds, uncoveredIds };
  }

  private coverageMessages(coverage: {
    unknownIds: string[];
    uncoveredIds: string[];
  }): string[] {
    const messages: string[] = [];
    if (coverage.unknownIds.length > 0) {
      messages.push(
        `references unknown functional requirement ids: ${coverage.unknownIds.join(', ')}`,
      );
    }
    if (coverage.uncoveredIds.length > 0) {
      messages.push(
        `does not cover these functional requirements: ${coverage.uncoveredIds.join(', ')}`,
      );
    }
    return messages;
  }

  private async findLatestSprintPlan(
    projectId: string,
  ): Promise<SprintPlan | null> {
    return this.prisma.sprintPlan.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
  }

  private async getLatestArchitectureOrThrow(
    projectId: string,
  ): Promise<Architecture> {
    const architecture = await this.prisma.architecture.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!architecture) {
      throw new ConflictException(
        'Architecture must be generated before Sprint Planning.',
      );
    }
    return architecture;
  }

  private async resolveAnalysisForArchitecture(
    architectureId: string,
  ): Promise<ProjectAnalysis> {
    const architecture = await this.prisma.architecture.findUniqueOrThrow({
      where: { id: architectureId },
    });
    return this.prisma.projectAnalysis.findUniqueOrThrow({
      where: { id: architecture.projectAnalysisId },
    });
  }

  private async persistNewVersion(
    projectId: string,
    data: {
      architectureId: string;
      source: AnalysisSource;
      basedOnVersion: number | null;
      content: SprintPlanContent;
      aiMetadata?: AIGenerationMetadata;
    },
  ): Promise<SprintPlan> {
    return this.prisma.$transaction(
      async (tx) => {
        const aggregate = await tx.sprintPlan.aggregate({
          where: { projectId },
          _max: { version: true },
        });
        const nextVersion = (aggregate._max.version ?? 0) + 1;

        const sprintPlan = await tx.sprintPlan.create({
          data: {
            projectId,
            architectureId: data.architectureId,
            version: nextVersion,
            source: data.source,
            basedOnVersion: data.basedOnVersion,
            summary: data.content.summary,
            strategy: data.content.strategy,
            estimatedSprintCount: data.content.sprints.length,
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

        const sprintIdByNumber = new Map<number, string>();
        for (const sprintContent of data.content.sprints) {
          const sprint = await tx.sprint.create({
            data: {
              sprintPlanId: sprintPlan.id,
              number: sprintContent.number,
              title: sprintContent.title,
              objective: sprintContent.objective,
              description: sprintContent.description ?? null,
              status: SprintStatus.PENDING,
              order: sprintContent.number,
            },
          });
          sprintIdByNumber.set(sprintContent.number, sprint.id);
        }

        const taskIdByKey = new Map<string, string>();
        for (const sprintContent of data.content.sprints) {
          const sprintId = sprintIdByNumber.get(sprintContent.number)!;
          let taskOrder = 0;
          for (const taskContent of sprintContent.tasks) {
            const task = await tx.task.create({
              data: {
                sprintPlanId: sprintPlan.id,
                sprintId,
                key: taskContent.key,
                title: taskContent.title,
                description: taskContent.description,
                status: TaskStatus.PENDING,
                order: taskOrder++,
                acceptanceCriteria: taskContent.acceptanceCriteria,
                validationExpectations: taskContent.validationExpectations,
                requirementIds: taskContent.requirementIds,
                architectureAreas: taskContent.architectureAreas,
              },
            });
            taskIdByKey.set(taskContent.key, task.id);
          }
        }

        for (const sprintContent of data.content.sprints) {
          const sprintId = sprintIdByNumber.get(sprintContent.number)!;
          for (const dependsOnNumber of sprintContent.dependencies) {
            await tx.sprintDependency.create({
              data: {
                sprintId,
                dependsOnSprintId: sprintIdByNumber.get(dependsOnNumber)!,
              },
            });
          }
        }

        for (const sprintContent of data.content.sprints) {
          for (const taskContent of sprintContent.tasks) {
            const taskId = taskIdByKey.get(taskContent.key)!;
            for (const dependsOnKey of taskContent.dependencies) {
              await tx.taskDependency.create({
                data: {
                  taskId,
                  dependsOnTaskId: taskIdByKey.get(dependsOnKey)!,
                },
              });
            }
          }
        }

        await tx.project.update({
          where: { id: projectId },
          data: { status: ProjectStatus.PLAN_READY },
        });

        return sprintPlan;
      },
      // A full plan can involve dozens of sequential inserts (sprints, tasks,
      // and both dependency join tables); the default ~5s interactive
      // transaction timeout is too tight for a large generated plan.
      { timeout: 20000 },
    );
  }

  private async hydrate(sprintPlanId: string): Promise<SprintPlanGraph> {
    const sprintPlan = await this.prisma.sprintPlan.findUniqueOrThrow({
      where: { id: sprintPlanId },
    });
    const [sprints, tasks, sprintDependencies, taskDependencies] =
      await Promise.all([
        this.prisma.sprint.findMany({
          where: { sprintPlanId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.task.findMany({
          where: { sprintPlanId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.sprintDependency.findMany({
          where: { sprint: { sprintPlanId } },
        }),
        this.prisma.taskDependency.findMany({
          where: { task: { sprintPlanId } },
        }),
      ]);

    const sprintNumberById = new Map(sprints.map((s) => [s.id, s.number]));
    const taskKeyById = new Map(tasks.map((t) => [t.id, t.key]));

    const sprintDependencyNumbers = new Map<string, number[]>();
    for (const dep of sprintDependencies) {
      const list = sprintDependencyNumbers.get(dep.sprintId) ?? [];
      list.push(sprintNumberById.get(dep.dependsOnSprintId)!);
      sprintDependencyNumbers.set(dep.sprintId, list);
    }

    const taskDependencyKeys = new Map<string, string[]>();
    for (const dep of taskDependencies) {
      const list = taskDependencyKeys.get(dep.taskId) ?? [];
      list.push(taskKeyById.get(dep.dependsOnTaskId)!);
      taskDependencyKeys.set(dep.taskId, list);
    }

    const tasksBySprintId = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const list = tasksBySprintId.get(task.sprintId) ?? [];
      list.push(task);
      tasksBySprintId.set(task.sprintId, list);
    }

    return {
      ...sprintPlan,
      sprints: sprints.map((sprint) => ({
        ...sprint,
        dependsOnSprintNumbers: (
          sprintDependencyNumbers.get(sprint.id) ?? []
        ).sort((a, b) => a - b),
        tasks: (tasksBySprintId.get(sprint.id) ?? []).map((task) => ({
          ...task,
          dependsOnTaskKeys: taskDependencyKeys.get(task.id) ?? [],
        })),
      })),
    };
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
        ProjectStatus.PLANNING,
        target,
      );
    } catch (compensationError) {
      // The one situation we must never allow silently: a project stuck in
      // PLANNING forever. Log loudly so this is never a quiet failure.
      this.logger.error(
        `Failed to restore project status after sprint plan generation failure (projectId=${projectId}, target=${target})`,
        compensationError instanceof Error
          ? compensationError.stack
          : undefined,
      );
    }
  }

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot modify the sprint plan for an archived project. Restore the project first.',
      );
    }
  }

  private assertPreDevelopment(project: Project): void {
    if (PRE_DEVELOPMENT_BLOCKED_STATUSES.includes(project.status)) {
      throw new ConflictException(
        'Cannot edit the sprint plan after development has started.',
      );
    }
  }
}
