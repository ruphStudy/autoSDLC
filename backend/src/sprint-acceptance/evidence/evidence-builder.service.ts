import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { GitService } from '../../workspace/git/git.service';
import {
  ArchitectureContextEvidence,
  ChangedFileEvidence,
  CommitSummaryEvidence,
  RequirementCoverageEntry,
  RiskSummaryEvidence,
  SprintAcceptanceEvidence,
  TaskEvidence,
  ValidationSummaryEvidence,
} from '../types/evidence.types';

// Bounds mirror the source schemas' own array caps (Architecture: 30 ADRs/
// 100 traceability entries; ProjectAnalysis: 60 FRs/20 risks/20 unresolved
// questions) — this builder never needs to re-bound beyond what those
// artifacts already guarantee, except for genuinely unbounded per-Sprint
// data like changed-file counts (item 126).
const MAX_CHANGED_FILES = 60;

export interface EvidenceBundle {
  evidence: SprintAcceptanceEvidence;
  liveHeadSha: string | null;
}

// Aggregates existing Sprint/Task/TaskExecution/ValidationAttempt/
// Architecture/ProjectAnalysis/Git state into one bounded, structured
// object (items 10-23). Never re-runs Sprint 13's validation checks (item
// 96) and never mutates anything — purely a read aggregator, exactly like
// Sprint 15's ExecutionMonitorService (item 122: efficient batched Prisma
// queries, no N+1).
@Injectable()
export class SprintAcceptanceEvidenceBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
  ) {}

  async build(sprintExecutionId: string): Promise<EvidenceBundle> {
    const sprintExecution = await this.prisma.sprintExecution.findUniqueOrThrow(
      { where: { id: sprintExecutionId } },
    );

    const sprint = await this.prisma.sprint.findUniqueOrThrow({
      where: { id: sprintExecution.sprintId },
    });

    const sprintPlan = await this.prisma.sprintPlan.findUniqueOrThrow({
      where: { id: sprintExecution.sprintPlanId },
    });

    const architecture = await this.prisma.architecture.findUniqueOrThrow({
      where: { id: sprintPlan.architectureId },
    });

    const projectAnalysis = await this.prisma.projectAnalysis.findUniqueOrThrow(
      { where: { id: architecture.projectAnalysisId } },
    );

    const tasks = await this.prisma.task.findMany({
      where: {
        sprintId: sprintExecution.sprintId,
        sprintPlanId: sprintExecution.sprintPlanId,
      },
      orderBy: { order: 'asc' },
    });
    const taskIds = tasks.map((t) => t.id);

    // Latest TaskExecution per Task, in one batched query (no N+1) — the
    // first row encountered per taskId is authoritative since results are
    // ordered by attempt desc.
    const allExecutions =
      taskIds.length === 0
        ? []
        : await this.prisma.taskExecution.findMany({
            where: { taskId: { in: taskIds } },
            orderBy: { attempt: 'desc' },
          });
    const latestExecutionByTaskId = new Map<
      string,
      (typeof allExecutions)[number]
    >();
    for (const execution of allExecutions) {
      if (!latestExecutionByTaskId.has(execution.taskId)) {
        latestExecutionByTaskId.set(execution.taskId, execution);
      }
    }

    // Latest ValidationAttempt per Task, including its runs (needed only
    // for the names of any failed required/optional checks — never
    // stdout/stderr, item 124).
    const allAttempts =
      taskIds.length === 0
        ? []
        : await this.prisma.validationAttempt.findMany({
            where: { taskId: { in: taskIds } },
            orderBy: { attempt: 'desc' },
            include: { runs: true },
          });
    const latestAttemptByTaskId = new Map<
      string,
      (typeof allAttempts)[number]
    >();
    for (const attempt of allAttempts) {
      if (!latestAttemptByTaskId.has(attempt.taskId)) {
        latestAttemptByTaskId.set(attempt.taskId, attempt);
      }
    }

    const taskEvidence: TaskEvidence[] = tasks.map((task) => {
      const execution = latestExecutionByTaskId.get(task.id) ?? null;
      const attempt = latestAttemptByTaskId.get(task.id) ?? null;
      return {
        key: task.key,
        title: task.title,
        description: task.description,
        status: task.status,
        acceptanceCriteria: task.acceptanceCriteria as string[],
        requirementIds: task.requirementIds as string[],
        architectureAreas: task.architectureAreas as string[],
        executionAttempt: execution?.attempt ?? null,
        commitSha: execution?.commitSha ?? null,
        changedFileCount: Array.isArray(execution?.changedFiles)
          ? (execution!.changedFiles as unknown[]).length
          : 0,
        validationStatus: attempt?.status ?? null,
        validationRequiredPassed: attempt?.requiredPassed ?? 0,
        validationRequiredFailed: attempt?.requiredFailed ?? 0,
      };
    });

    const requirementCoverage = this.buildRequirementCoverage(
      tasks,
      taskEvidence,
      projectAnalysis.functionalRequirements as Array<{
        id: string;
        title: string;
      }>,
    );

    const validationSummary = this.buildValidationSummary(
      Array.from(latestAttemptByTaskId.values()),
    );

    const commitSummary = this.buildCommitSummary(
      sprintExecution,
      tasks,
      taskEvidence,
    );

    const architectureContext = this.buildArchitectureContext(
      tasks,
      architecture.architectureDecisions as Array<{
        id: string;
        title: string;
        decision: string;
      }>,
    );

    const riskSummary = this.buildRiskSummary(
      projectAnalysis.risks as Array<{
        risk: string;
        severity: string;
        mitigation?: string;
      }>,
      architecture.unresolvedQuestions as Array<{
        question: string;
        impact: string;
      }>,
      Array.from(latestAttemptByTaskId.values()),
    );

    const changedFiles = this.buildChangedFiles(
      Array.from(latestExecutionByTaskId.values()),
    );

    const workspace = await this.buildWorkspaceSnapshot(
      sprintExecution.projectId,
    );

    const evidence: SprintAcceptanceEvidence = {
      sprint: {
        id: sprint.id,
        number: sprint.number,
        title: sprint.title,
        objective: sprint.objective,
        status: sprint.status,
      },
      sprintPlan: { id: sprintPlan.id, version: sprintPlan.version },
      architecture: { id: architecture.id, version: architecture.version },
      projectAnalysis: {
        id: projectAnalysis.id,
        version: projectAnalysis.version,
      },
      sprintExecution: {
        id: sprintExecution.id,
        attempt: sprintExecution.attempt,
        status: sprintExecution.status,
        startedAt: sprintExecution.startedAt?.toISOString() ?? null,
        completedAt: sprintExecution.completedAt?.toISOString() ?? null,
        repositoryStartSha: sprintExecution.repositoryStartSha,
        repositoryEndSha: sprintExecution.repositoryEndSha,
        totalTasks: sprintExecution.totalTasks,
        passedTasks: sprintExecution.passedTasks,
      },
      tasks: taskEvidence,
      requirementCoverage,
      architectureContext,
      validationSummary,
      commitSummary,
      riskSummary,
      changedFiles,
      workspace: {
        clean: workspace.clean,
        headCommitSha: workspace.headCommitSha,
        branch: workspace.branch,
      },
    };

    return { evidence, liveHeadSha: workspace.headCommitSha };
  }

  private buildRequirementCoverage(
    tasks: {
      id: string;
      key: string;
      requirementIds: unknown;
      status: string;
    }[],
    taskEvidence: TaskEvidence[],
    functionalRequirements: Array<{ id: string; title: string }>,
  ): RequirementCoverageEntry[] {
    // Sprint-scoped requirement set (item 15) — only requirements this
    // Sprint's own Tasks actually reference, never every Project FR (item
    // 14).
    const requirementIds = new Set<string>();
    for (const task of tasks) {
      for (const id of (task.requirementIds as string[]) ?? []) {
        requirementIds.add(id);
      }
    }

    const titleById = new Map(
      functionalRequirements.map((fr) => [fr.id, fr.title]),
    );
    const evidenceByTaskId = new Map(
      taskEvidence.map((t) => [t.key, t] as const),
    );

    return Array.from(requirementIds).map((requirementId) => {
      const owningTasks = tasks.filter((t) =>
        ((t.requirementIds as string[]) ?? []).includes(requirementId),
      );
      const owningTaskEvidence = owningTasks
        .map((t) => evidenceByTaskId.get(t.key))
        .filter((e): e is TaskEvidence => e !== undefined);

      return {
        requirementId,
        title:
          titleById.get(requirementId) ??
          '(requirement not found in current analysis)',
        taskKeys: owningTasks.map((t) => t.key),
        tasksPassed: owningTasks.every((t) => t.status === 'PASSED'),
        validationPassed: owningTaskEvidence.every(
          (e) => e.validationStatus === 'PASSED',
        ),
        commitShas: owningTaskEvidence
          .map((e) => e.commitSha)
          .filter((sha): sha is string => sha !== null),
      };
    });
  }

  private buildValidationSummary(
    attempts: { runs: { name: string; required: boolean; status: string }[] }[],
  ): ValidationSummaryEvidence {
    let totalRuns = 0;
    let requiredRuns = 0;
    let requiredPassed = 0;
    let optionalPassed = 0;
    let optionalFailed = 0;
    const failedRequiredChecks: string[] = [];

    for (const attempt of attempts) {
      for (const run of attempt.runs) {
        totalRuns += 1;
        if (run.required) {
          requiredRuns += 1;
          if (run.status === 'PASSED') requiredPassed += 1;
          else if (run.status === 'FAILED') failedRequiredChecks.push(run.name);
        } else {
          if (run.status === 'PASSED') optionalPassed += 1;
          else if (run.status === 'FAILED') optionalFailed += 1;
        }
      }
    }

    return {
      totalRuns,
      requiredRuns,
      requiredPassed,
      optionalPassed,
      optionalFailed,
      failedRequiredChecks,
    };
  }

  private buildCommitSummary(
    sprintExecution: {
      repositoryStartSha: string | null;
      repositoryEndSha: string | null;
    },
    tasks: { status: string }[],
    taskEvidence: TaskEvidence[],
  ): CommitSummaryEvidence {
    const commits = taskEvidence
      .filter((t) => t.commitSha !== null)
      .map((t) => ({
        taskKey: t.key,
        commitSha: t.commitSha!,
        changedFileCount: t.changedFileCount,
      }));

    // Every Task that reached PASSED must have a recorded commit (item
    // 20) — Sprint 13's own design guarantees PASSED is only ever set
    // alongside a successful commit, so this is a consistency check on
    // that invariant, not a re-derivation of it.
    const passedTasksMissingCommit = taskEvidence.filter(
      (t) => t.status === 'PASSED' && t.commitSha === null,
    );

    return {
      startSha: sprintExecution.repositoryStartSha,
      endSha: sprintExecution.repositoryEndSha,
      commits,
      chainComplete: passedTasksMissingCommit.length === 0,
    };
  }

  private buildArchitectureContext(
    tasks: { architectureAreas: unknown }[],
    architectureDecisions: Array<{
      id: string;
      title: string;
      decision: string;
    }>,
  ): ArchitectureContextEvidence {
    const areas = new Set<string>();
    for (const task of tasks) {
      for (const area of (task.architectureAreas as string[]) ?? []) {
        areas.add(area);
      }
    }
    // The schema has no per-ADR "area" tag to filter by (only id/title/
    // context/decision/rationale) — rather than fabricate a false-precision
    // relevance filter, every ADR is included as context; `allAdrIds` is
    // also the full authoritative set the review validator checks findings
    // against (item 18/31).
    return {
      relevantAreas: Array.from(areas),
      relevantAdrs: architectureDecisions.map((adr) => ({
        id: adr.id,
        title: adr.title,
        decision: adr.decision,
      })),
      allAdrIds: architectureDecisions.map((adr) => adr.id),
    };
  }

  private buildRiskSummary(
    risks: Array<{ risk: string; severity: string; mitigation?: string }>,
    unresolvedQuestions: Array<{ question: string; impact: string }>,
    attempts: { runs: { name: string; required: boolean; status: string }[] }[],
  ): RiskSummaryEvidence {
    const optionalValidationFailures: string[] = [];
    for (const attempt of attempts) {
      for (const run of attempt.runs) {
        if (!run.required && run.status === 'FAILED') {
          optionalValidationFailures.push(run.name);
        }
      }
    }

    return {
      projectRisks: risks.map((r) => ({
        risk: r.risk,
        severity: r.severity,
        mitigation: r.mitigation ?? null,
      })),
      unresolvedArchitectureQuestions: unresolvedQuestions.map((q) => ({
        question: q.question,
        impact: q.impact,
      })),
      optionalValidationFailures,
    };
  }

  private buildChangedFiles(
    executions: { changedFiles: unknown }[],
  ): ChangedFileEvidence[] {
    const countByPath = new Map<string, number>();
    for (const execution of executions) {
      if (!Array.isArray(execution.changedFiles)) continue;
      for (const file of execution.changedFiles as { path?: string }[]) {
        if (!file?.path) continue;
        countByPath.set(file.path, (countByPath.get(file.path) ?? 0) + 1);
      }
    }
    return Array.from(countByPath.entries())
      .slice(0, MAX_CHANGED_FILES)
      .map(([path, taskCount]) => ({ path, taskCount }));
  }

  private async buildWorkspaceSnapshot(projectId: string): Promise<{
    clean: boolean | null;
    headCommitSha: string | null;
    branch: string | null;
  }> {
    try {
      const workspacePath =
        await this.workspaceService.getReadyWorkspacePath(projectId);
      const [status, headCommitSha, branch] = await Promise.all([
        this.git.getStatus(workspacePath),
        this.git.getHeadCommitSha(workspacePath),
        this.git.getCurrentBranch(workspacePath),
      ]);
      return { clean: status.clean, headCommitSha, branch };
    } catch {
      return { clean: null, headCommitSha: null, branch: null };
    }
  }
}
