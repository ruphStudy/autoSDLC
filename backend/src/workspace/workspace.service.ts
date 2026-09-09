import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  JobType,
  Project,
  ProjectWorkspace,
  RepositoryType,
  WorkspaceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { mapApprovalErrorToHttpException } from '../approval/errors/approval-error.mapper';
import { JobService } from '../jobs/job.service';
import { JobRecord, JobExecutionContext } from '../jobs/types/job.types';
import { GitService } from './git/git.service';
import { WorkspacePathService } from './workspace-path.service';
import { WorkspaceConfigService } from './workspace.config';
import { GitError, GitErrorCode } from './errors/git.error';
import { mapGitErrorToHttpException } from './errors/workspace-error.mapper';
import { isSupportedRepositoryUrl } from './git/git-url.util';
import { RemoteInfo, RepositoryReadiness } from './git/git.types';
import {
  WorkspaceDiffResult,
  WorkspaceRecord,
  WorkspaceStatusResult,
} from './types/workspace.types';

const PREPARABLE_STATUSES: WorkspaceStatus[] = [
  WorkspaceStatus.NOT_PREPARED,
  WorkspaceStatus.INVALID,
  WorkspaceStatus.FAILED,
];

function toRecord(
  workspace: ProjectWorkspace,
  clean: boolean | null = null,
): WorkspaceRecord {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    status: workspace.status,
    defaultBranch: workspace.defaultBranch,
    developmentBranch: workspace.developmentBranch,
    currentBranch: workspace.currentBranch,
    remoteName: workspace.remoteName,
    remoteUrl: workspace.remoteUrl,
    headCommitSha: workspace.headCommitSha,
    clean,
    errorCode: workspace.errorCode,
    errorMessage: workspace.errorMessage,
    preparedAt: workspace.preparedAt,
    lastValidatedAt: workspace.lastValidatedAt,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

// Orchestrates the Git/filesystem workspace lifecycle for a Project.
// Git-specific commands live entirely in GitService; this service owns
// ownership/approval/state-machine guards and persists only metadata —
// the actual source code lives on disk / in Git, never in this table.
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly jobService: JobService,
    private readonly git: GitService,
    private readonly paths: WorkspacePathService,
    private readonly config: WorkspaceConfigService,
  ) {}

  // ---- reads -------------------------------------------------------

  async getWorkspace(
    userId: string,
    projectId: string,
  ): Promise<WorkspaceRecord> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const workspace = await this.getOrCreateRecord(project.id);

    let clean: boolean | null = null;
    if (workspace.status === WorkspaceStatus.READY && workspace.workspacePath) {
      try {
        clean = (await this.git.getStatus(workspace.workspacePath)).clean;
      } catch {
        clean = null;
      }
    }
    return toRecord(workspace, clean);
  }

  async validate(
    userId: string,
    projectId: string,
  ): Promise<RepositoryReadiness> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const workspace = await this.getOrCreateRecord(project.id);

    if (
      !workspace.workspacePath ||
      workspace.status === WorkspaceStatus.NOT_PREPARED
    ) {
      return {
        ready: false,
        gitRepository: false,
        clean: false,
        branch: null,
        developmentBranch: workspace.developmentBranch,
        headCommitSha: null,
        remoteConfigured: false,
        issues: ['Workspace has not been prepared yet.'],
      };
    }

    const developmentBranch =
      workspace.developmentBranch ?? this.config.developmentBranch;
    const readiness = await this.computeReadiness(
      workspace.workspacePath,
      developmentBranch,
    );

    await this.prisma.projectWorkspace.update({
      where: { id: workspace.id },
      data: {
        lastValidatedAt: new Date(),
        status: readiness.ready
          ? WorkspaceStatus.READY
          : WorkspaceStatus.INVALID,
        currentBranch: readiness.branch,
        headCommitSha: readiness.headCommitSha,
      },
    });

    return readiness;
  }

  async getGitStatus(
    userId: string,
    projectId: string,
  ): Promise<WorkspaceStatusResult> {
    const { workspace } = await this.requireReadyWorkspace(userId, projectId);
    return this.git.getStatus(workspace.workspacePath!);
  }

  async getDiff(
    userId: string,
    projectId: string,
    options: { staged?: boolean } = {},
  ): Promise<WorkspaceDiffResult> {
    const { workspace } = await this.requireReadyWorkspace(userId, projectId);
    return this.git.getDiff(workspace.workspacePath!, options);
  }

  // Reusable gate for future sprints (coding agent execution) — throws the
  // raw domain error so both HTTP and background-job callers can decide how
  // to surface it, mirroring ApprovalService.assertDevelopmentApproved.
  async assertWorkspaceReady(projectId: string): Promise<void> {
    await this.getReadyWorkspacePath(projectId);
  }

  // Internal-only: hands the resolved workspace path to trusted server code
  // (e.g. Sprint 10's CodingAgentService) that must actually operate on the
  // workspace, never to an HTTP response body — WorkspaceRecord (the public
  // DTO) deliberately excludes this field. Throws the same raw GitError as
  // assertWorkspaceReady when the workspace isn't READY.
  async getReadyWorkspacePath(projectId: string): Promise<string> {
    const workspace = await this.prisma.projectWorkspace.findUnique({
      where: { projectId },
    });
    if (
      !workspace ||
      workspace.status !== WorkspaceStatus.READY ||
      !workspace.workspacePath
    ) {
      throw new GitError({
        code: GitErrorCode.WORKSPACE_NOT_READY,
        message: 'Workspace is not ready for development.',
      });
    }
    return workspace.workspacePath;
  }

  // ---- preparation ---------------------------------------------------

  async prepare(
    userId: string,
    projectId: string,
  ): Promise<{ workspace: WorkspaceRecord; job: JobRecord }> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);

    // Fail fast before touching any workspace state at all.
    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        throw mapApprovalErrorToHttpException(error);
      }
      throw error;
    }

    const workspace = await this.getOrCreateRecord(project.id);
    if (!PREPARABLE_STATUSES.includes(workspace.status)) {
      throw new ConflictException(
        workspace.status === WorkspaceStatus.READY
          ? 'The workspace is already prepared. Clean up or reprepare before preparing again.'
          : 'A workspace preparation is already in progress.',
      );
    }

    // Atomic claim: only one concurrent prepare() call can win this.
    const claimed = await this.prisma.projectWorkspace.updateMany({
      where: { id: workspace.id, status: { in: PREPARABLE_STATUSES } },
      data: {
        status: WorkspaceStatus.PREPARING,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'A workspace preparation is already in progress.',
      );
    }

    try {
      const job = await this.jobService.enqueue({
        type: JobType.WORKSPACE_PREPARE,
        projectId: project.id,
        userId,
        payload: {},
      });
      const refreshed = await this.prisma.projectWorkspace.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      return { workspace: toRecord(refreshed), job };
    } catch (error) {
      // Never strand the workspace in PREPARING if enqueueing itself failed.
      await this.prisma.projectWorkspace.updateMany({
        where: { id: workspace.id, status: WorkspaceStatus.PREPARING },
        data: { status: workspace.status },
      });
      throw error;
    }
  }

  // Called by WorkspacePrepareJobHandler at the start of every execution
  // attempt (including retries) — unconditional, since only the single
  // claimed job for this project can reach this point.
  async markPreparing(projectId: string): Promise<void> {
    await this.prisma.projectWorkspace.updateMany({
      where: { projectId },
      data: {
        status: WorkspaceStatus.PREPARING,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  // The actual Git/filesystem work — invoked only from
  // WorkspacePrepareJobHandler, never directly from an HTTP request.
  async runPreparation(
    projectId: string,
    context: Pick<JobExecutionContext, 'reportProgress'>,
  ): Promise<WorkspaceRecord> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const workspacePath = this.paths.resolveProjectWorkspacePath(projectId);

    try {
      await context.reportProgress(5, 'Preparing workspace directory...');
      // Clean slate: remove any partial leftover from a previous failed attempt.
      await this.paths.removeWorkspaceDirectory(workspacePath);
      await this.paths.ensureDirectory(workspacePath);

      const developmentBranch = this.config.developmentBranch;
      let defaultBranch: string;
      let remote: RemoteInfo | null = null;

      if (project.repositoryType === RepositoryType.EXISTING) {
        if (!project.repositoryUrl) {
          throw new GitError({
            code: GitErrorCode.WORKSPACE_INVALID,
            message: 'No repository URL configured for this project.',
          });
        }
        if (!isSupportedRepositoryUrl(project.repositoryUrl)) {
          throw new GitError({
            code: GitErrorCode.INVALID_REMOTE,
            message:
              'Unsupported repository URL. Only public HTTPS or SSH Git URLs are supported.',
          });
        }

        await context.reportProgress(15, 'Cloning repository...');
        await this.git.clone(project.repositoryUrl, workspacePath);

        await context.reportProgress(50, 'Inspecting repository...');
        defaultBranch =
          (await this.git.getCurrentBranch(workspacePath)) ??
          this.config.defaultBranch;
        remote = await this.git.getRemoteInfo(workspacePath);

        await context.reportProgress(65, 'Configuring workspace identity...');
        await this.git.configureIdentity(
          workspacePath,
          this.config.authorName,
          this.config.authorEmail,
        );

        await context.reportProgress(75, 'Creating development branch...');
        await this.git.createBranch(workspacePath, developmentBranch);
      } else {
        await context.reportProgress(20, 'Initializing repository...');
        defaultBranch = this.config.defaultBranch;
        await this.git.init(workspacePath, defaultBranch);
        await this.git.configureIdentity(
          workspacePath,
          this.config.authorName,
          this.config.authorEmail,
        );

        await context.reportProgress(50, 'Creating initial commit...');
        // Git can exist without commits, but branching before any commit is
        // fragile across workflows — one harmless empty commit gives every
        // later branch/diff/commit operation solid ground to build on.
        await this.git.commit(
          workspacePath,
          'chore: initialize autonomous development workspace',
          { allowEmpty: true },
        );

        await context.reportProgress(75, 'Creating development branch...');
        await this.git.createBranch(workspacePath, developmentBranch);
      }

      await context.reportProgress(90, 'Validating workspace...');
      const readiness = await this.computeReadiness(
        workspacePath,
        developmentBranch,
      );
      if (!readiness.ready) {
        throw new GitError({
          code: GitErrorCode.WORKSPACE_INVALID,
          message: `Workspace validation failed: ${readiness.issues.join('; ')}`,
        });
      }

      const updated = await this.prisma.projectWorkspace.update({
        where: { projectId },
        data: {
          status: WorkspaceStatus.READY,
          workspacePath,
          defaultBranch,
          developmentBranch,
          currentBranch: readiness.branch,
          remoteName: remote?.name ?? null,
          remoteUrl: remote?.url ?? null,
          headCommitSha: readiness.headCommitSha,
          preparedAt: new Date(),
          lastValidatedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      await context.reportProgress(100, 'Workspace ready.');
      this.logger.log(
        `Workspace prepared (projectId=${projectId}, branch=${developmentBranch})`,
      );
      return toRecord(updated);
    } catch (error) {
      const code =
        error instanceof GitError ? error.code : 'workspace_prepare_failed';
      const message =
        error instanceof Error
          ? error.message
          : 'An unknown error occurred while preparing the workspace.';
      await this.prisma.projectWorkspace.update({
        where: { projectId },
        data: {
          status: WorkspaceStatus.FAILED,
          errorCode: code,
          errorMessage: message,
        },
      });
      this.logger.warn(
        `Workspace preparation failed (projectId=${projectId}, code=${code})`,
      );
      throw error;
    }
  }

  // ---- cleanup ---------------------------------------------------------

  async cleanup(userId: string, projectId: string): Promise<WorkspaceRecord> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    const workspace = await this.getOrCreateRecord(project.id);

    if (
      workspace.status === WorkspaceStatus.PREPARING ||
      workspace.status === WorkspaceStatus.CLEANING
    ) {
      throw new ConflictException(
        'Cannot clean up a workspace while it is being prepared.',
      );
    }

    // Reads the sprintExecution table directly (same precedent as the
    // projectId/archivedAt checks above and ApprovalService's direct reads
    // of sibling artifact tables) — never pull the workspace directory out
    // from under a live autonomous Sprint execution (item 136).
    const activeSprintExecution = await this.prisma.sprintExecution.findFirst({
      where: {
        projectId: project.id,
        status: { in: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'] },
      },
    });
    if (activeSprintExecution) {
      throw new ConflictException(
        'Cannot clean up the workspace while a Sprint execution is active. Cancel it first.',
      );
    }

    if (
      workspace.workspacePath &&
      (await this.paths.exists(workspace.workspacePath))
    ) {
      if (workspace.status === WorkspaceStatus.READY) {
        const status = await this.git.getStatus(workspace.workspacePath);
        if (!status.clean) {
          throw mapGitErrorToHttpException(
            new GitError({
              code: GitErrorCode.DIRTY_WORKTREE,
              message:
                'The workspace has uncommitted changes. Commit or discard them before cleaning up.',
            }),
          );
        }
      }

      await this.prisma.projectWorkspace.update({
        where: { id: workspace.id },
        data: { status: WorkspaceStatus.CLEANING },
      });
      await this.paths.removeWorkspaceDirectory(workspace.workspacePath);
    }

    const updated = await this.prisma.projectWorkspace.update({
      where: { id: workspace.id },
      data: {
        status: WorkspaceStatus.NOT_PREPARED,
        workspacePath: null,
        defaultBranch: null,
        developmentBranch: null,
        currentBranch: null,
        remoteName: null,
        remoteUrl: null,
        headCommitSha: null,
        errorCode: null,
        errorMessage: null,
        preparedAt: null,
        lastValidatedAt: null,
      },
    });
    this.logger.log(`Workspace cleaned up (projectId=${project.id})`);
    return toRecord(updated);
  }

  // ---- internals -------------------------------------------------------

  private async getOrCreateRecord(
    projectId: string,
  ): Promise<ProjectWorkspace> {
    const existing = await this.prisma.projectWorkspace.findUnique({
      where: { projectId },
    });
    if (existing) return existing;
    return this.prisma.projectWorkspace.create({
      data: { projectId, status: WorkspaceStatus.NOT_PREPARED },
    });
  }

  private async requireReadyWorkspace(
    userId: string,
    projectId: string,
  ): Promise<{ project: Project; workspace: ProjectWorkspace }> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const workspace = await this.getOrCreateRecord(project.id);
    if (
      workspace.status !== WorkspaceStatus.READY ||
      !workspace.workspacePath
    ) {
      throw mapGitErrorToHttpException(
        new GitError({
          code: GitErrorCode.WORKSPACE_NOT_READY,
          message: 'The workspace is not ready yet.',
        }),
      );
    }
    return { project, workspace };
  }

  private async computeReadiness(
    workspacePath: string,
    developmentBranch: string,
  ): Promise<RepositoryReadiness> {
    const issues: string[] = [];
    const isRepo = await this.git.isInsideWorkTree(workspacePath);
    if (!isRepo) {
      issues.push('Not a Git repository.');
    }

    let branch: string | null = null;
    let clean = false;
    let headCommitSha: string | null = null;
    let remoteConfigured = false;

    if (isRepo) {
      branch = await this.git.getCurrentBranch(workspacePath);
      if (branch !== developmentBranch) {
        issues.push(
          `Expected to be on branch "${developmentBranch}", but current branch is "${branch ?? 'unknown'}".`,
        );
      }
      const status = await this.git.getStatus(workspacePath);
      clean = status.clean;
      headCommitSha = await this.git.getHeadCommitSha(workspacePath);
      remoteConfigured = (await this.git.getRemoteInfo(workspacePath)) !== null;
    }

    return {
      ready: isRepo && issues.length === 0,
      gitRepository: isRepo,
      clean,
      branch,
      developmentBranch,
      headCommitSha,
      remoteConfigured,
      issues,
    };
  }

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot manage the workspace for an archived project. Restore the project first.',
      );
    }
  }
}
