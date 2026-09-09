import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GitService } from '../../workspace/git/git.service';
import { RepositoryTreeService } from '../repository/repository-tree.service';
import { TaskInstructionConfigService } from '../task-instruction.config';
import {
  TaskInstructionError,
  TaskInstructionErrorCode,
} from '../errors/task-instruction.error';
import {
  DependencyTaskContext,
  RelevantAdr,
  RelevantArchitectureArea,
  RelevantRequirement,
  TaskContext,
} from '../contracts/task-context.types';

// Architecture's own JSON field names — the only strings task.architectureAreas
// is ever allowed to select from (never a dynamic/unchecked object index).
const ARCHITECTURE_AREA_FIELDS = new Set([
  'frontendArchitecture',
  'backendArchitecture',
  'apiArchitecture',
  'databaseArchitecture',
  'authenticationArchitecture',
  'integrationArchitecture',
  'infrastructureArchitecture',
  'deploymentArchitecture',
  'securityArchitecture',
  'testingStrategy',
]);

interface ArchitectureDecisionJson {
  id?: string;
  title?: string;
  decision?: string;
  rationale?: string;
}

interface FunctionalRequirementJson {
  id?: string;
  title?: string;
  description?: string;
}

// Gathers exactly the bounded, repository-aware context Sprint 11's
// instruction prompt needs — never a full source dump (item 20). Assumes
// its caller (TaskInstructionService) has already validated approval and
// workspace readiness/cleanliness; this only reads state.
@Injectable()
export class TaskContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitService,
    private readonly tree: RepositoryTreeService,
    private readonly config: TaskInstructionConfigService,
  ) {}

  async build(taskId: string, workspacePath: string): Promise<TaskContext> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        sprint: true,
        sprintPlan: {
          include: {
            architecture: {
              include: { projectAnalysis: true },
            },
            project: true,
          },
        },
        dependencies: { include: { dependsOnTask: true } },
      },
    });
    if (!task) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.TASK_NOT_FOUND,
        message: 'Task not found.',
      });
    }

    const { sprintPlan, sprint } = task;
    const { architecture } = sprintPlan;
    const { projectAnalysis } = architecture;
    const project = sprintPlan.project;

    const requirementIds = asStringArray(task.requirementIds);
    const architectureAreas = asStringArray(task.architectureAreas);
    const functionalRequirements = (projectAnalysis.functionalRequirements ??
      []) as FunctionalRequirementJson[];
    const architectureDecisions = (architecture.architectureDecisions ??
      []) as ArchitectureDecisionJson[];

    const relevantRequirements: RelevantRequirement[] = functionalRequirements
      .filter((fr) => fr.id && requirementIds.includes(fr.id))
      .map((fr) => ({
        id: fr.id!,
        title: fr.title ?? '',
        description: fr.description ?? '',
      }));

    const relevantAreas: RelevantArchitectureArea[] = architectureAreas
      .filter((area) => ARCHITECTURE_AREA_FIELDS.has(area))
      .map((area) => ({
        area,
        content: (architecture as unknown as Record<string, unknown>)[area],
      }));

    // MVP scope decision (see final report): every ADR is included rather
    // than attempting text-similarity relevance matching against the Task —
    // Architecture's own ADR list is already small/bounded from Sprint 5's
    // own generation limits, and building a real relevance-ranking system
    // here would be exactly the "overbuilt RAG" item 19 warns against.
    const relevantAdrs: RelevantAdr[] = architectureDecisions
      .filter((adr) => adr.id && adr.title && adr.decision)
      .map((adr) => ({
        id: adr.id!,
        title: adr.title!,
        decision: adr.decision!,
        rationale: adr.rationale,
      }));

    const dependencies: DependencyTaskContext[] = [];
    for (const dep of task.dependencies) {
      const dependencyTask = dep.dependsOnTask;
      const lastAgentJob = await this.prisma.agentJob.findFirst({
        where: { taskId: dependencyTask.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, summary: true },
      });
      dependencies.push({
        taskKey: dependencyTask.key,
        title: dependencyTask.title,
        status: dependencyTask.status,
        lastAttempt: lastAgentJob
          ? { status: lastAgentJob.status, summary: lastAgentJob.summary }
          : undefined,
      });
    }

    let repositoryContext: TaskContext['repository'];
    try {
      const [
        branch,
        headCommitSha,
        status,
        treeResult,
        manifests,
        recentCommits,
      ] = await Promise.all([
        this.git.getCurrentBranch(workspacePath),
        this.git.getHeadCommitSha(workspacePath),
        this.git.getStatus(workspacePath),
        this.tree.listTree(workspacePath, {
          maxEntries: this.config.maxTreeEntries,
        }),
        this.tree.readManifestFiles(workspacePath, {
          maxFiles: this.config.maxFiles,
          maxFileBytes: this.config.maxFileBytes,
          maxTotalBytes: this.config.maxTotalBytes,
        }),
        this.git.getRecentCommits(workspacePath, this.config.recentCommits),
      ]);

      repositoryContext = {
        branch,
        headCommitSha,
        clean: status.clean,
        tree: treeResult,
        manifests: manifests.files,
        manifestsSkipped: manifests.skipped,
        manifestsTruncated: manifests.totalBytesTruncated,
        recentCommits,
      };
    } catch (error) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.CONTEXT_BUILD_FAILED,
        message:
          'Failed to inspect the repository while building Task context.',
        cause: error,
      });
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        brief: project.brief,
        repositoryType: project.repositoryType,
      },
      projectAnalysis: {
        id: projectAnalysis.id,
        version: projectAnalysis.version,
        summary: projectAnalysis.summary,
      },
      architecture: {
        id: architecture.id,
        version: architecture.version,
        summary: architecture.summary,
        relevantAreas,
        relevantAdrs,
      },
      sprintPlan: {
        id: sprintPlan.id,
        version: sprintPlan.version,
        summary: sprintPlan.summary,
        strategy: sprintPlan.strategy,
      },
      sprint: {
        id: sprint.id,
        number: sprint.number,
        title: sprint.title,
        objective: sprint.objective,
      },
      task: {
        id: task.id,
        key: task.key,
        title: task.title,
        description: task.description,
        acceptanceCriteria: asStringArray(task.acceptanceCriteria),
        validationExpectations: asValidationExpectations(
          task.validationExpectations,
        ),
        requirementIds,
        architectureAreas,
        relevantRequirements,
      },
      dependencies,
      repository: repositoryContext,
    };
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asValidationExpectations(
  value: unknown,
): Array<{ type: string; description: string; required: boolean }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      type: typeof item.type === 'string' ? item.type : 'other',
      description: typeof item.description === 'string' ? item.description : '',
      required: Boolean(item.required),
    }));
}
