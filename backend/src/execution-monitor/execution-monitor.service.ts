import { Injectable, Logger } from '@nestjs/common';
import {
  AgentJob,
  Prisma,
  Sprint,
  SprintExecution,
  SprintExecutionStatus,
  Task,
  TaskExecution,
  TaskStatus,
  ValidationAttempt,
  ValidationRun,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from '../workspace/git/git.service';
import { SprintExecutionService } from '../sprint-execution/sprint-execution.service';
import { resolveExecutionPhase } from './phase-resolver';
import {
  ActiveSprintExecutionSummary,
  AgentActivitySummary,
  CommitHistoryEntry,
  CurrentTaskSummary,
  ExecutionHistoryEntry,
  ExecutionTimelineEvent,
  ExecutionUsageSummary,
  NextSprintSummary,
  ProjectExecutionOverview,
  SprintProgressSummary,
  TaskPipelineEntry,
  TimelinePage,
  ValidationActivitySummary,
  ValidationCheckSummary,
  WorkspaceSummary,
} from './types/execution-monitor.types';

// A SprintExecution counts as "live" (worth polling) using the exact same
// vocabulary SprintExecutionService itself uses for its own one-active-
// execution-per-project guard — kept as a small local copy rather than an
// import of a private constant (see Sprint 14's own module for the
// original).
const ACTIVE_SPRINT_EXECUTION_STATUSES: SprintExecutionStatus[] = [
  SprintExecutionStatus.QUEUED,
  SprintExecutionStatus.RUNNING,
  SprintExecutionStatus.PAUSED,
  SprintExecutionStatus.BLOCKED,
];

const DEFAULT_EVENTS_LIMIT = 20;
const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;
const DEFAULT_COMMITS_LIMIT = 10;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
// Bounds how many recent TaskExecution/ValidationAttempt rows are scanned
// to synthesize timeline events (item 83) — this project's own Sprints
// never realistically approach this many Tasks, so it is a safety cap, not
// a practical limit.
const TIMELINE_SOURCE_ROW_CAP = 300;

// Matches CodingAgentToolActivity's actual shape ({ type, name, ... }) —
// see coding-agent/contracts/coding-agent-result.ts.
function shortToolName(activity: unknown): string | null {
  if (
    typeof activity === 'object' &&
    activity !== null &&
    'name' in activity &&
    typeof (activity as { name: unknown }).name === 'string'
  ) {
    return (activity as { name: string }).name;
  }
  return null;
}

// The read model / aggregator for Sprint 15's Execution Monitoring
// Dashboard (item 3). Deliberately READS ONLY — never mutates a Task,
// TaskExecution, AgentJob, ValidationAttempt, or SprintExecution row, and
// never calls a mutating method on any of those services (item 122:
// MonitoringService reads, SprintExecutionService/TaskExecutionService/
// TaskValidationService mutate). Derives everything from those existing
// entities plus a live (never cached) Git read of the workspace — it is
// never a second source of truth (item 2/85): no new persistence model is
// introduced here.
@Injectable()
export class ExecutionMonitorService {
  private readonly logger = new Logger(ExecutionMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly sprintExecutionService: SprintExecutionService,
  ) {}

  async getOverview(
    userId: string,
    projectId: string,
  ): Promise<ProjectExecutionOverview> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );

    const [workspace, currentPlan] = await Promise.all([
      this.buildWorkspaceSummary(projectId),
      this.prisma.sprintPlan.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { id: true },
      }),
    ]);

    if (!currentPlan) {
      return {
        projectId,
        projectStatus: project.status,
        archived: project.archivedAt !== null,
        workspace,
        hasActiveExecution: false,
        activeSprintExecution: null,
        currentTask: null,
        agent: null,
        validation: null,
        sprintProgress: [],
        usage: emptyUsage(),
        recentCommits: [],
        recentEvents: [],
        nextSprintEligible: null,
      };
    }

    const [sprints, latestExecution] = await Promise.all([
      this.prisma.sprint.findMany({
        where: { sprintPlanId: currentPlan.id },
        orderBy: { order: 'asc' },
      }),
      this.prisma.sprintExecution.findFirst({
        where: { sprint: { sprintPlanId: currentPlan.id } },
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    const sprintProgress = await this.buildSprintProgress(
      sprints,
      workspace.headCommitSha,
    );
    const hasActiveExecution = latestExecution
      ? ACTIVE_SPRINT_EXECUTION_STATUSES.includes(latestExecution.status)
      : false;

    let activeSprintExecution: ActiveSprintExecutionSummary | null = null;
    let currentTask: CurrentTaskSummary | null = null;
    let agent: AgentActivitySummary | null = null;
    let validation: ValidationActivitySummary | null = null;
    let usage = emptyUsage();

    if (latestExecution) {
      const sprint = sprints.find((s) => s.id === latestExecution.sprintId);
      const tasks = await this.prisma.task.findMany({
        where: {
          sprintId: latestExecution.sprintId,
          sprintPlanId: currentPlan.id,
        },
        orderBy: { order: 'asc' },
      });

      const detail = await this.buildCurrentTaskDetail(latestExecution);
      currentTask = detail.currentTask;
      agent = detail.agent;
      validation = detail.validation;
      const commitShaByTaskId = await this.buildCommitShaByTaskId(
        tasks.map((t) => t.id),
      );

      activeSprintExecution = {
        id: latestExecution.id,
        sprintId: latestExecution.sprintId,
        sprintNumber: sprint?.number ?? 0,
        sprintTitle: sprint?.title ?? '',
        sprintObjective: sprint?.objective ?? '',
        attempt: latestExecution.attempt,
        status: latestExecution.status,
        currentPhase: resolveExecutionPhase({
          sprintExecutionStatus: latestExecution.status,
          taskExecution: detail.taskExecutionForPhase,
          agentJob: detail.agentJobForPhase,
          validationAttempt: detail.validationAttemptForPhase,
        }),
        progressPercent:
          latestExecution.totalTasks > 0
            ? Math.round(
                (latestExecution.passedTasks / latestExecution.totalTasks) *
                  100,
              )
            : 0,
        totalTasks: latestExecution.totalTasks,
        passedTasks: latestExecution.passedTasks,
        currentTaskId: latestExecution.currentTaskId,
        pauseRequested: latestExecution.pauseRequested,
        startedAt: latestExecution.startedAt?.toISOString() ?? null,
        completedAt: latestExecution.completedAt?.toISOString() ?? null,
        repositoryStartSha: latestExecution.repositoryStartSha,
        repositoryEndSha: latestExecution.repositoryEndSha,
        errorCode: latestExecution.errorCode,
        errorMessage: latestExecution.errorMessage,
        isLive: hasActiveExecution,
        tasks: tasks.map((t) =>
          toPipelineEntry(t, commitShaByTaskId.get(t.id) ?? null),
        ),
        backgroundJobId: latestExecution.backgroundJobId,
      };

      usage = await this.aggregateUsage(tasks.map((t) => t.id));
    }

    const [recentCommits, recentEvents, nextSprintEligible] = await Promise.all(
      [
        this.buildRecentCommits(currentPlan.id),
        this.buildTimeline(currentPlan.id, {
          limit: DEFAULT_EVENTS_LIMIT,
        }).then((page) => page.events),
        hasActiveExecution
          ? Promise.resolve(null)
          : this.findNextEligibleSprint(userId, projectId, sprints),
      ],
    );

    return {
      projectId,
      projectStatus: project.status,
      archived: project.archivedAt !== null,
      workspace,
      hasActiveExecution,
      activeSprintExecution,
      currentTask,
      agent,
      validation,
      sprintProgress,
      usage,
      recentCommits,
      recentEvents,
      nextSprintEligible,
    };
  }

  async getHistory(
    userId: string,
    projectId: string,
    params: { limit?: number; cursor?: string } = {},
  ): Promise<{
    executions: ExecutionHistoryEntry[];
    nextCursor: string | null;
  }> {
    await this.projectsService.findOneForUser(userId, projectId);
    const limit = clamp(
      params.limit ?? DEFAULT_HISTORY_LIMIT,
      1,
      MAX_HISTORY_LIMIT,
    );

    const where: Prisma.SprintExecutionWhereInput = { projectId };
    if (params.cursor) {
      const cursorDate = new Date(params.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }

    const executions = await this.prisma.sprintExecution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: { sprint: { select: { number: true, title: true } } },
    });

    const page = executions.slice(0, limit);
    const nextCursor =
      executions.length > limit
        ? page[page.length - 1].createdAt.toISOString()
        : null;

    return {
      executions: page.map((e) => ({
        id: e.id,
        sprintId: e.sprintId,
        sprintNumber: e.sprint.number,
        sprintTitle: e.sprint.title,
        attempt: e.attempt,
        status: e.status,
        startedAt: e.startedAt?.toISOString() ?? null,
        completedAt: e.completedAt?.toISOString() ?? null,
        totalTasks: e.totalTasks,
        passedTasks: e.passedTasks,
        repositoryStartSha: e.repositoryStartSha,
        repositoryEndSha: e.repositoryEndSha,
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
      })),
      nextCursor,
    };
  }

  async getTimeline(
    userId: string,
    projectId: string,
    params: { limit?: number; cursor?: string } = {},
  ): Promise<TimelinePage> {
    await this.projectsService.findOneForUser(userId, projectId);
    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan) return { events: [], nextCursor: null };

    const limit = clamp(
      params.limit ?? DEFAULT_TIMELINE_LIMIT,
      1,
      MAX_TIMELINE_LIMIT,
    );
    return this.buildTimeline(currentPlan.id, {
      limit,
      cursor: params.cursor,
    });
  }

  // ---- workspace -----------------------------------------------------

  private async buildWorkspaceSummary(
    projectId: string,
  ): Promise<WorkspaceSummary> {
    const workspace = await this.prisma.projectWorkspace.findUnique({
      where: { projectId },
    });
    if (!workspace) {
      return {
        status: 'NOT_PREPARED',
        branch: null,
        clean: null,
        headCommitSha: null,
      };
    }
    if (workspace.status !== 'READY') {
      return {
        status: workspace.status,
        branch: workspace.currentBranch,
        clean: null,
        headCommitSha: workspace.headCommitSha,
      };
    }

    // Live read (item 27): the cached ProjectWorkspace row is only ever
    // refreshed at prepare/cleanup time, never during autonomous
    // execution, so it would otherwise show a stale branch/HEAD/clean
    // state while a Sprint is actively coding.
    try {
      const workspacePath =
        await this.workspaceService.getReadyWorkspacePath(projectId);
      const [branch, status, headCommitSha] = await Promise.all([
        this.git.getCurrentBranch(workspacePath),
        this.git.getStatus(workspacePath),
        this.git.getHeadCommitSha(workspacePath),
      ]);
      return { status: 'READY', branch, clean: status.clean, headCommitSha };
    } catch (error) {
      this.logger.warn(
        `Could not read live workspace state for project ${projectId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {
        status: workspace.status,
        branch: workspace.currentBranch,
        clean: null,
        headCommitSha: workspace.headCommitSha,
      };
    }
  }

  // ---- Sprint progress -------------------------------------------------

  private async buildSprintProgress(
    sprints: Pick<Sprint, 'id' | 'number' | 'title' | 'objective' | 'status'>[],
    liveHeadSha: string | null,
  ): Promise<SprintProgressSummary[]> {
    if (sprints.length === 0) return [];
    const sprintIds = sprints.map((s) => s.id);
    const grouped = await this.prisma.task.groupBy({
      by: ['sprintId', 'status'],
      where: { sprintId: { in: sprintIds } },
      _count: { _all: true },
    });

    // Latest SprintAcceptance per Sprint, in one batched query (item
    // 109/122) — lightweight only: status/recommendation/staleness/version,
    // never the full findings/evidence on every dashboard poll.
    const allAcceptances = await this.prisma.sprintAcceptance.findMany({
      where: { sprintId: { in: sprintIds } },
      orderBy: { version: 'desc' },
      select: {
        sprintId: true,
        status: true,
        recommendation: true,
        repositoryHeadSha: true,
        version: true,
      },
    });
    const latestAcceptanceBySprintId = new Map<
      string,
      (typeof allAcceptances)[number]
    >();
    for (const acceptance of allAcceptances) {
      if (!latestAcceptanceBySprintId.has(acceptance.sprintId)) {
        latestAcceptanceBySprintId.set(acceptance.sprintId, acceptance);
      }
    }

    const countsBySprintId = new Map<string, Record<TaskStatus, number>>();
    for (const sprint of sprints) {
      countsBySprintId.set(sprint.id, {
        PENDING: 0,
        READY: 0,
        RUNNING: 0,
        REVIEWING: 0,
        PASSED: 0,
        FAILED: 0,
        BLOCKED: 0,
      });
    }
    for (const row of grouped) {
      const counts = countsBySprintId.get(row.sprintId);
      if (counts) counts[row.status] = row._count._all;
    }

    return sprints.map((sprint) => {
      const counts = countsBySprintId.get(sprint.id)!;
      const totalTasks = Object.values(counts).reduce((a, b) => a + b, 0);
      const remainingTasks = totalTasks - counts.PASSED;
      const acceptance = latestAcceptanceBySprintId.get(sprint.id);
      return {
        sprintId: sprint.id,
        number: sprint.number,
        title: sprint.title,
        objective: sprint.objective,
        status: sprint.status,
        totalTasks,
        passedTasks: counts.PASSED,
        runningTasks: counts.RUNNING,
        reviewingTasks: counts.REVIEWING,
        failedTasks: counts.FAILED,
        blockedTasks: counts.BLOCKED,
        remainingTasks,
        progressPercent:
          totalTasks > 0 ? Math.round((counts.PASSED / totalTasks) * 100) : 0,
        acceptance: acceptance
          ? {
              status: acceptance.status,
              recommendation: acceptance.recommendation,
              stale:
                acceptance.repositoryHeadSha !== null &&
                acceptance.repositoryHeadSha !== liveHeadSha,
              latestVersion: acceptance.version,
            }
          : null,
      };
    });
  }

  // ---- current Task / Agent / Validation detail -------------------------

  private async buildCurrentTaskDetail(execution: SprintExecution): Promise<{
    currentTask: CurrentTaskSummary | null;
    agent: AgentActivitySummary | null;
    validation: ValidationActivitySummary | null;
    taskExecutionForPhase: {
      status: TaskExecution['status'];
      agentJobId: string | null;
    } | null;
    agentJobForPhase: { status: AgentJob['status'] } | null;
    validationAttemptForPhase: {
      status: ValidationAttempt['status'];
      runs: { status: ValidationRun['status'] }[];
    } | null;
  }> {
    if (!execution.currentTaskId) {
      return {
        currentTask: null,
        agent: null,
        validation: null,
        taskExecutionForPhase: null,
        agentJobForPhase: null,
        validationAttemptForPhase: null,
      };
    }

    const task = await this.prisma.task.findUnique({
      where: { id: execution.currentTaskId },
    });
    if (!task) {
      return {
        currentTask: null,
        agent: null,
        validation: null,
        taskExecutionForPhase: null,
        agentJobForPhase: null,
        validationAttemptForPhase: null,
      };
    }

    const latestTaskExecution = await this.prisma.taskExecution.findFirst({
      where: { taskId: task.id },
      orderBy: { attempt: 'desc' },
    });

    let agentJob: AgentJob | null = null;
    if (latestTaskExecution?.agentJobId) {
      agentJob = await this.prisma.agentJob.findUnique({
        where: { id: latestTaskExecution.agentJobId },
      });
    }

    let validationAttempt:
      (ValidationAttempt & { runs: ValidationRun[] }) | null = null;
    if (latestTaskExecution) {
      validationAttempt = await this.prisma.validationAttempt.findFirst({
        where: { taskExecutionId: latestTaskExecution.id },
        orderBy: { attempt: 'desc' },
        include: { runs: true },
      });
    }

    const instruction = latestTaskExecution?.taskInstructionId
      ? await this.prisma.taskInstruction.findUnique({
          where: { id: latestTaskExecution.taskInstructionId },
          select: { version: true },
        })
      : null;

    const changedFiles = Array.isArray(latestTaskExecution?.changedFiles)
      ? (latestTaskExecution!.changedFiles as unknown[]).length
      : 0;

    const currentTask: CurrentTaskSummary = {
      id: task.id,
      key: task.key,
      title: task.title,
      status: task.status,
      executionAttempt: latestTaskExecution?.attempt ?? null,
      executionStatus: latestTaskExecution?.status ?? null,
      instructionVersion: instruction?.version ?? null,
      changedFileCount: changedFiles,
      startedAt: latestTaskExecution?.startedAt?.toISOString() ?? null,
      durationMs: latestTaskExecution?.durationMs ?? null,
    };

    const agent: AgentActivitySummary | null = agentJob
      ? {
          id: agentJob.id,
          provider: agentJob.provider,
          model: agentJob.model,
          status: agentJob.status,
          startedAt: agentJob.startedAt?.toISOString() ?? null,
          completedAt: agentJob.completedAt?.toISOString() ?? null,
          durationMs: agentJob.durationMs,
          inputTokens: agentJob.inputTokens,
          outputTokens: agentJob.outputTokens,
          turns: agentJob.turns,
          changedFileCount: Array.isArray(agentJob.changedFiles)
            ? (agentJob.changedFiles as unknown[]).length
            : 0,
          toolActivityCounts: summarizeToolActivity(agentJob.toolActivities),
          commandActivityCount: Array.isArray(agentJob.commandActivities)
            ? (agentJob.commandActivities as unknown[]).length
            : 0,
          summary: agentJob.summary,
          errorCode: agentJob.errorCode,
          errorMessage: agentJob.errorMessage,
        }
      : null;

    const validation: ValidationActivitySummary | null = validationAttempt
      ? {
          id: validationAttempt.id,
          attempt: validationAttempt.attempt,
          status: validationAttempt.status,
          requiredPassed: validationAttempt.requiredPassed,
          requiredFailed: validationAttempt.requiredFailed,
          optionalPassed: validationAttempt.optionalPassed,
          optionalFailed: validationAttempt.optionalFailed,
          checks: validationAttempt.runs.map(toCheckSummary),
          commitSha: validationAttempt.commitSha,
          errorCode: validationAttempt.errorCode,
          errorMessage: validationAttempt.errorMessage,
        }
      : null;

    return {
      currentTask,
      agent,
      validation,
      taskExecutionForPhase: latestTaskExecution
        ? {
            status: latestTaskExecution.status,
            agentJobId: latestTaskExecution.agentJobId,
          }
        : null,
      agentJobForPhase: agentJob ? { status: agentJob.status } : null,
      validationAttemptForPhase: validationAttempt
        ? {
            status: validationAttempt.status,
            runs: validationAttempt.runs.map((r) => ({ status: r.status })),
          }
        : null,
    };
  }

  // One batched query for the whole Task pipeline (item 83) rather than a
  // per-Task lookup — a Task only ever commits once it reaches PASSED, so
  // the highest-attempt committed TaskExecution per Task is authoritative.
  private async buildCommitShaByTaskId(
    taskIds: string[],
  ): Promise<Map<string, string>> {
    if (taskIds.length === 0) return new Map();
    const committed = await this.prisma.taskExecution.findMany({
      where: { taskId: { in: taskIds }, commitSha: { not: null } },
      orderBy: { attempt: 'desc' },
      select: { taskId: true, commitSha: true },
    });
    const map = new Map<string, string>();
    for (const row of committed) {
      if (!map.has(row.taskId) && row.commitSha) {
        map.set(row.taskId, row.commitSha);
      }
    }
    return map;
  }

  // ---- usage -------------------------------------------------------------

  private async aggregateUsage(
    taskIds: string[],
  ): Promise<ExecutionUsageSummary> {
    if (taskIds.length === 0) return emptyUsage();

    const [agentUsage, planningUsage] = await Promise.all([
      this.prisma.agentJob.aggregate({
        where: { taskId: { in: taskIds } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.taskInstruction.aggregate({
        where: { taskId: { in: taskIds } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    const codingAgent = {
      inputTokens: agentUsage._sum.inputTokens ?? 0,
      outputTokens: agentUsage._sum.outputTokens ?? 0,
      totalTokens:
        (agentUsage._sum.inputTokens ?? 0) +
        (agentUsage._sum.outputTokens ?? 0),
    };
    const planningAi = {
      inputTokens: planningUsage._sum.inputTokens ?? 0,
      outputTokens: planningUsage._sum.outputTokens ?? 0,
      totalTokens:
        (planningUsage._sum.inputTokens ?? 0) +
        (planningUsage._sum.outputTokens ?? 0),
    };
    return { codingAgent, planningAi };
  }

  // ---- commits -------------------------------------------------------------

  private async buildRecentCommits(
    sprintPlanId: string,
  ): Promise<CommitHistoryEntry[]> {
    const committed = await this.prisma.taskExecution.findMany({
      where: { task: { sprintPlanId }, commitSha: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: DEFAULT_COMMITS_LIMIT,
      include: { task: { select: { key: true, title: true } } },
    });

    if (committed.length === 0) return [];

    // One extra query, never one per commit (item 83): validation attempt
    // numbers are looked up in a single batch keyed by taskExecutionId.
    const attempts = await this.prisma.validationAttempt.findMany({
      where: {
        taskExecutionId: { in: committed.map((c) => c.id) },
        commitSha: { not: null },
      },
      select: { taskExecutionId: true, attempt: true },
    });
    const attemptByExecutionId = new Map(
      attempts.map((a) => [a.taskExecutionId, a.attempt]),
    );

    return committed.map((execution) => ({
      taskId: execution.taskId,
      taskKey: execution.task.key,
      taskTitle: execution.task.title,
      commitSha: execution.commitSha!,
      committedAt: execution.completedAt?.toISOString() ?? null,
      validationAttempt: attemptByExecutionId.get(execution.id) ?? null,
      changedFileCount: Array.isArray(execution.changedFiles)
        ? (execution.changedFiles as unknown[]).length
        : null,
    }));
  }

  // ---- timeline -----------------------------------------------------------

  // Synthesizes timeline events purely from existing entities' own
  // timestamps (item 9) — never a new persistence model (item 85). Bounded
  // by TIMELINE_SOURCE_ROW_CAP so this can never scan an unbounded amount
  // of history for a long-lived project (item 83).
  private async buildTimeline(
    sprintPlanId: string,
    params: { limit: number; cursor?: string },
  ): Promise<TimelinePage> {
    const cursorDate = params.cursor ? new Date(params.cursor) : null;
    const beforeFilter =
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? { lt: cursorDate }
        : undefined;

    const [sprintExecutions, taskExecutions, validationAttempts] =
      await Promise.all([
        this.prisma.sprintExecution.findMany({
          where: { sprint: { sprintPlanId } },
          orderBy: { createdAt: 'desc' },
          take: TIMELINE_SOURCE_ROW_CAP,
          include: { sprint: { select: { number: true, title: true } } },
        }),
        this.prisma.taskExecution.findMany({
          where: { task: { sprintPlanId } },
          orderBy: { createdAt: 'desc' },
          take: TIMELINE_SOURCE_ROW_CAP,
          include: { task: { select: { key: true, sprintId: true } } },
        }),
        this.prisma.validationAttempt.findMany({
          where: { task: { sprintPlanId } },
          orderBy: { createdAt: 'desc' },
          take: TIMELINE_SOURCE_ROW_CAP,
          include: { task: { select: { key: true, sprintId: true } } },
        }),
      ]);

    const events: ExecutionTimelineEvent[] = [];

    for (const se of sprintExecutions) {
      if (se.startedAt) {
        events.push({
          id: `sprint-${se.id}-started`,
          type: 'SPRINT_STARTED',
          timestamp: se.startedAt.toISOString(),
          scope: 'SPRINT',
          title: `Sprint ${se.sprint.number} — ${se.sprint.title} started`,
          severity: 'INFO',
          sprintId: se.sprintId,
          status: 'RUNNING',
        });
      }
      if (se.completedAt) {
        events.push({
          id: `sprint-${se.id}-ended`,
          type: `SPRINT_${se.status}`,
          timestamp: se.completedAt.toISOString(),
          scope: 'SPRINT',
          title: `Sprint ${se.sprint.number} — ${se.sprint.title} ${se.status.toLowerCase()}`,
          description: se.errorMessage ?? undefined,
          severity: severityForSprintExecutionStatus(se.status),
          sprintId: se.sprintId,
          status: se.status,
        });
      }
    }

    for (const te of taskExecutions) {
      if (te.startedAt) {
        events.push({
          id: `task-exec-${te.id}-started`,
          type: 'TASK_EXECUTION_STARTED',
          timestamp: te.startedAt.toISOString(),
          scope: 'TASK',
          title: `${te.task.key}: coding agent started`,
          severity: 'INFO',
          sprintId: te.task.sprintId,
          taskId: te.taskId,
          taskKey: te.task.key,
        });
      }
      if (te.completedAt) {
        events.push({
          id: `task-exec-${te.id}-ended`,
          type: `TASK_EXECUTION_${te.status}`,
          timestamp: te.completedAt.toISOString(),
          scope: 'AGENT',
          title: `${te.task.key}: coding agent ${te.status.toLowerCase().replace(/_/g, ' ')}`,
          description: te.errorMessage ?? undefined,
          severity: severityForTaskExecutionStatus(te.status),
          sprintId: te.task.sprintId,
          taskId: te.taskId,
          taskKey: te.task.key,
          metadata: { changedFileCount: countJsonArray(te.changedFiles) },
        });
      }
    }

    for (const va of validationAttempts) {
      if (va.startedAt) {
        events.push({
          id: `validation-${va.id}-started`,
          type: 'VALIDATION_STARTED',
          timestamp: va.startedAt.toISOString(),
          scope: 'VALIDATION',
          title: `${va.task.key}: validation started`,
          severity: 'INFO',
          sprintId: va.task.sprintId,
          taskId: va.taskId,
          taskKey: va.task.key,
        });
      }
      if (va.completedAt) {
        events.push({
          id: `validation-${va.id}-ended`,
          type: `VALIDATION_${va.status}`,
          timestamp: va.completedAt.toISOString(),
          scope: 'VALIDATION',
          title: `${va.task.key}: validation ${va.status.toLowerCase()}`,
          description: va.errorMessage ?? undefined,
          severity: severityForValidationStatus(va.status),
          sprintId: va.task.sprintId,
          taskId: va.taskId,
          taskKey: va.task.key,
          metadata: {
            requiredPassed: va.requiredPassed,
            requiredFailed: va.requiredFailed,
          },
        });
      }
      if (va.commitSha) {
        events.push({
          id: `commit-${va.id}`,
          type: 'GIT_COMMIT',
          timestamp: (va.completedAt ?? va.updatedAt).toISOString(),
          scope: 'GIT',
          title: `${va.task.key}: committed ${va.commitSha.slice(0, 10)}`,
          severity: 'SUCCESS',
          sprintId: va.task.sprintId,
          taskId: va.taskId,
          taskKey: va.task.key,
          metadata: { commitSha: va.commitSha },
        });
      }
    }

    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const filtered = beforeFilter
      ? events.filter((e) => new Date(e.timestamp) < beforeFilter.lt)
      : events;
    const page = filtered.slice(0, params.limit);
    const nextCursor =
      filtered.length > params.limit ? page[page.length - 1].timestamp : null;

    return { events: page, nextCursor };
  }

  // ---- next Sprint (read-only reuse of Sprint 14's own eligibility) ------

  private async findNextEligibleSprint(
    userId: string,
    projectId: string,
    sprints: Pick<Sprint, 'id' | 'number' | 'title' | 'status'>[],
  ): Promise<NextSprintSummary | null> {
    const candidates = sprints
      .filter((s) => s.status !== 'PASSED')
      .sort((a, b) => a.number - b.number);
    for (const candidate of candidates) {
      try {
        const eligibility = await this.sprintExecutionService.getEligibility(
          userId,
          projectId,
          candidate.id,
        );
        if (eligibility.runnable) {
          return {
            sprintId: candidate.id,
            number: candidate.number,
            title: candidate.title,
          };
        }
      } catch {
        // Reads only — never let an eligibility-check failure break the
        // whole dashboard; simply treat this candidate as not eligible.
      }
    }
    return null;
  }
}

function toPipelineEntry(
  task: Task,
  commitSha: string | null,
): TaskPipelineEntry {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    commitSha,
  };
}

function toCheckSummary(run: ValidationRun): ValidationCheckSummary {
  return {
    type: run.type,
    name: run.name,
    required: run.required,
    status: run.status,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
  };
}

function summarizeToolActivity(raw: unknown): Record<string, number> {
  if (!Array.isArray(raw)) return {};
  const counts: Record<string, number> = {};
  for (const entry of raw) {
    const tool = shortToolName(entry);
    if (!tool) continue;
    counts[tool] = (counts[tool] ?? 0) + 1;
  }
  return counts;
}

function countJsonArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function emptyUsage(): ExecutionUsageSummary {
  return {
    codingAgent: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    planningAi: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function severityForSprintExecutionStatus(
  status: SprintExecutionStatus,
): 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' {
  if (status === 'COMPLETED') return 'SUCCESS';
  if (status === 'FAILED' || status === 'BLOCKED') return 'ERROR';
  if (status === 'CANCELLED' || status === 'PAUSED') return 'WARNING';
  return 'INFO';
}

function severityForTaskExecutionStatus(
  status: TaskExecution['status'],
): 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' {
  if (status === 'READY_FOR_VALIDATION') return 'SUCCESS';
  if (status === 'FAILED') return 'ERROR';
  if (status === 'CANCELLED') return 'WARNING';
  return 'INFO';
}

function severityForValidationStatus(
  status: ValidationAttempt['status'],
): 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' {
  if (status === 'PASSED') return 'SUCCESS';
  if (status === 'FAILED') return 'ERROR';
  if (status === 'CANCELLED') return 'WARNING';
  return 'INFO';
}
