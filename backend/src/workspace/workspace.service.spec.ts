import { ConflictException } from '@nestjs/common';
import { JobType, RepositoryType, WorkspaceStatus } from '@prisma/client';
import { WorkspaceService } from './workspace.service';
import { GitError, GitErrorCode } from './errors/git.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';

function buildWorkspace(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'workspace-1',
    projectId: 'project-1',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    userId: 'user-1',
    name: 'Project',
    repositoryType: RepositoryType.NEW,
    repositoryUrl: null,
    archivedAt: null,
    ...overrides,
  };
}

describe('WorkspaceService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let jobService: any;
  let git: any;
  let paths: any;
  let config: any;
  let service: WorkspaceService;

  beforeEach(() => {
    prisma = {
      project: { findUniqueOrThrow: jest.fn() },
      projectWorkspace: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    projectsService = { findOneForUser: jest.fn() };
    approvalService = { assertDevelopmentApproved: jest.fn() };
    jobService = { enqueue: jest.fn() };
    git = {
      getStatus: jest.fn(),
      getDiff: jest.fn(),
      isInsideWorkTree: jest.fn(),
      getCurrentBranch: jest.fn(),
      getHeadCommitSha: jest.fn(),
      getRemoteInfo: jest.fn(),
      clone: jest.fn(),
      configureIdentity: jest.fn(),
      createBranch: jest.fn(),
      init: jest.fn(),
      commit: jest.fn(),
    };
    paths = {
      resolveProjectWorkspacePath: jest.fn((id: string) => `/workspaces/${id}`),
      removeWorkspaceDirectory: jest.fn(),
      ensureDirectory: jest.fn(),
      exists: jest.fn(),
    };
    config = {
      developmentBranch: 'autodev/development',
      defaultBranch: 'main',
      authorName: 'Autonomous Dev Orchestrator',
      authorEmail: 'autodev@localhost',
    };

    service = new WorkspaceService(
      prisma,
      projectsService,
      approvalService,
      jobService,
      git,
      paths,
      config,
    );
  });

  describe('getWorkspace', () => {
    it('creates a NOT_PREPARED record on first access', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(null);
      prisma.projectWorkspace.create.mockResolvedValue(buildWorkspace());

      const result = await service.getWorkspace('user-1', 'project-1');

      expect(prisma.projectWorkspace.create).toHaveBeenCalledWith({
        data: { projectId: 'project-1', status: WorkspaceStatus.NOT_PREPARED },
      });
      expect(result.status).toBe(WorkspaceStatus.NOT_PREPARED);
      expect(result).not.toHaveProperty('workspacePath');
    });

    it('includes a live clean/dirty flag when the workspace is READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
        }),
      );
      git.getStatus.mockResolvedValue({ clean: false, files: [] });

      const result = await service.getWorkspace('user-1', 'project-1');
      expect(result.clean).toBe(false);
    });

    it('leaves clean null when not READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());

      const result = await service.getWorkspace('user-1', 'project-1');
      expect(result.clean).toBeNull();
      expect(git.getStatus).not.toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    it('reports not-ready without touching Git when never prepared', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());

      const result = await service.validate('user-1', 'project-1');
      expect(result.ready).toBe(false);
      expect(git.isInsideWorkTree).not.toHaveBeenCalled();
    });

    it('marks the workspace INVALID when the branch does not match', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
          developmentBranch: 'autodev/development',
        }),
      );
      git.isInsideWorkTree.mockResolvedValue(true);
      git.getCurrentBranch.mockResolvedValue('main');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('abc123');
      git.getRemoteInfo.mockResolvedValue(null);

      const result = await service.validate('user-1', 'project-1');

      expect(result.ready).toBe(false);
      expect(result.issues[0]).toContain('autodev/development');
      expect(prisma.projectWorkspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WorkspaceStatus.INVALID }),
        }),
      );
    });

    it('confirms READY when everything checks out', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
          developmentBranch: 'autodev/development',
        }),
      );
      git.isInsideWorkTree.mockResolvedValue(true);
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('abc123');
      git.getRemoteInfo.mockResolvedValue(null);

      const result = await service.validate('user-1', 'project-1');
      expect(result.ready).toBe(true);
      expect(result.issues).toEqual([]);
    });
  });

  describe('getGitStatus / getDiff', () => {
    it('rejects when the workspace is not READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());

      await expect(
        service.getGitStatus('user-1', 'project-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: GitErrorCode.WORKSPACE_NOT_READY,
        }),
      });
    });

    it('delegates to GitService when READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
        }),
      );
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getDiff.mockResolvedValue({
        diff: '',
        truncated: false,
        sizeBytes: 0,
      });

      await service.getGitStatus('user-1', 'project-1');
      expect(git.getStatus).toHaveBeenCalledWith('/workspaces/project-1');

      await service.getDiff('user-1', 'project-1', { staged: true });
      expect(git.getDiff).toHaveBeenCalledWith('/workspaces/project-1', {
        staged: true,
      });
    });
  });

  describe('assertWorkspaceReady', () => {
    it('throws a raw GitError (not an HttpException) when no workspace exists', async () => {
      prisma.projectWorkspace.findUnique.mockResolvedValue(null);
      await expect(
        service.assertWorkspaceReady('project-1'),
      ).rejects.toBeInstanceOf(GitError);
    });

    it('resolves when the workspace is READY', async () => {
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
        }),
      );
      await expect(
        service.assertWorkspaceReady('project-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('prepare', () => {
    it('rejects for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.prepare('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
    });

    it('maps a missing development approval to an HTTP exception before touching workspace state', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'Development has not been approved.',
        }),
      );

      await expect(service.prepare('user-1', 'project-1')).rejects.toThrow();
      expect(prisma.projectWorkspace.findUnique).not.toHaveBeenCalled();
      expect(prisma.projectWorkspace.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the workspace is already READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockResolvedValue(undefined);
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.READY }),
      );

      await expect(
        service.prepare('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.projectWorkspace.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when a preparation is already in flight (lost the atomic claim race)', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockResolvedValue(undefined);
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());
      prisma.projectWorkspace.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.prepare('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it('claims PREPARING and enqueues a WORKSPACE_PREPARE job on the happy path', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockResolvedValue(undefined);
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());
      prisma.projectWorkspace.updateMany.mockResolvedValue({ count: 1 });
      prisma.projectWorkspace.findUniqueOrThrow.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.PREPARING }),
      );
      jobService.enqueue.mockResolvedValue({
        id: 'job-1',
        type: JobType.WORKSPACE_PREPARE,
      });

      const result = await service.prepare('user-1', 'project-1');

      expect(prisma.projectWorkspace.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WorkspaceStatus.PREPARING }),
        }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JobType.WORKSPACE_PREPARE,
          projectId: 'project-1',
        }),
      );
      expect(result.job.id).toBe('job-1');
      expect(result.workspace.status).toBe(WorkspaceStatus.PREPARING);
    });

    it('rolls back the PREPARING claim if enqueue fails', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockResolvedValue(undefined);
      prisma.projectWorkspace.findUnique.mockResolvedValue(buildWorkspace());
      prisma.projectWorkspace.updateMany.mockResolvedValue({ count: 1 });
      jobService.enqueue.mockRejectedValue(new Error('boom'));

      await expect(service.prepare('user-1', 'project-1')).rejects.toThrow(
        'boom',
      );

      expect(prisma.projectWorkspace.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'workspace-1', status: WorkspaceStatus.PREPARING },
        data: { status: WorkspaceStatus.NOT_PREPARED },
      });
    });
  });

  describe('runPreparation (NEW repository flow)', () => {
    const context = { reportProgress: jest.fn().mockResolvedValue(undefined) };

    beforeEach(() => {
      prisma.project.findUniqueOrThrow.mockResolvedValue(buildProject());
      git.init.mockResolvedValue(undefined);
      git.configureIdentity.mockResolvedValue(undefined);
      git.commit.mockResolvedValue('abc123');
      git.createBranch.mockResolvedValue(undefined);
      git.isInsideWorkTree.mockResolvedValue(true);
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('abc123');
      git.getRemoteInfo.mockResolvedValue(null);
      prisma.projectWorkspace.update.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.READY }),
      );
    });

    it('initializes a repo, commits, branches, and marks READY', async () => {
      const result = await service.runPreparation('project-1', context);

      expect(paths.removeWorkspaceDirectory).toHaveBeenCalledWith(
        '/workspaces/project-1',
      );
      expect(paths.ensureDirectory).toHaveBeenCalledWith(
        '/workspaces/project-1',
      );
      expect(git.init).toHaveBeenCalledWith('/workspaces/project-1', 'main');
      expect(git.commit).toHaveBeenCalledWith(
        '/workspaces/project-1',
        expect.stringContaining('initialize'),
        { allowEmpty: true },
      );
      expect(git.createBranch).toHaveBeenCalledWith(
        '/workspaces/project-1',
        'autodev/development',
      );
      expect(git.clone).not.toHaveBeenCalled();
      expect(prisma.projectWorkspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WorkspaceStatus.READY }),
        }),
      );
      expect(result.status).toBe(WorkspaceStatus.READY);
    });

    it('marks the workspace FAILED and rethrows if branch creation fails', async () => {
      git.createBranch.mockRejectedValue(
        new GitError({ code: GitErrorCode.BRANCH_FAILED, message: 'boom' }),
      );
      prisma.projectWorkspace.update.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.FAILED }),
      );

      await expect(
        service.runPreparation('project-1', context),
      ).rejects.toMatchObject({
        code: GitErrorCode.BRANCH_FAILED,
      });
      expect(prisma.projectWorkspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkspaceStatus.FAILED,
            errorCode: GitErrorCode.BRANCH_FAILED,
          }),
        }),
      );
    });
  });

  describe('runPreparation (EXISTING repository flow)', () => {
    const context = { reportProgress: jest.fn().mockResolvedValue(undefined) };

    it('clones, configures identity, and creates the development branch', async () => {
      prisma.project.findUniqueOrThrow.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: 'https://example.com/org/repo.git',
        }),
      );
      git.clone.mockResolvedValue(undefined);
      git.getCurrentBranch
        .mockResolvedValueOnce('main')
        .mockResolvedValue('autodev/development');
      git.getRemoteInfo.mockResolvedValue({
        name: 'origin',
        url: 'https://example.com/org/repo.git',
      });
      git.configureIdentity.mockResolvedValue(undefined);
      git.createBranch.mockResolvedValue(undefined);
      git.isInsideWorkTree.mockResolvedValue(true);
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('def456');
      prisma.projectWorkspace.update.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.READY }),
      );

      const result = await service.runPreparation('project-1', context);

      expect(git.clone).toHaveBeenCalledWith(
        'https://example.com/org/repo.git',
        '/workspaces/project-1',
      );
      expect(git.init).not.toHaveBeenCalled();
      expect(git.commit).not.toHaveBeenCalled();
      expect(result.status).toBe(WorkspaceStatus.READY);
    });

    it('rejects an unsupported repository URL before ever calling clone', async () => {
      prisma.project.findUniqueOrThrow.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: 'file:///etc',
        }),
      );
      prisma.projectWorkspace.update.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.FAILED }),
      );

      await expect(
        service.runPreparation('project-1', context),
      ).rejects.toMatchObject({
        code: GitErrorCode.INVALID_REMOTE,
      });
      expect(git.clone).not.toHaveBeenCalled();
    });

    it('rejects EXISTING type with no URL configured', async () => {
      prisma.project.findUniqueOrThrow.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: null,
        }),
      );
      prisma.projectWorkspace.update.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.FAILED }),
      );

      await expect(
        service.runPreparation('project-1', context),
      ).rejects.toMatchObject({
        code: GitErrorCode.WORKSPACE_INVALID,
      });
    });
  });

  describe('cleanup', () => {
    it('rejects while a preparation is in flight', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({ status: WorkspaceStatus.PREPARING }),
      );

      await expect(
        service.cleanup('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects cleanup of a READY workspace with uncommitted changes', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
        }),
      );
      paths.exists.mockResolvedValue(true);
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [{ path: 'a.txt', status: 'MODIFIED', staged: false }],
      });

      await expect(
        service.cleanup('user-1', 'project-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: GitErrorCode.DIRTY_WORKTREE,
        }),
      });
      expect(paths.removeWorkspaceDirectory).not.toHaveBeenCalled();
    });

    it('removes a clean READY workspace and resets it to NOT_PREPARED', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.READY,
          workspacePath: '/workspaces/project-1',
        }),
      );
      paths.exists.mockResolvedValue(true);
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      prisma.projectWorkspace.update.mockResolvedValue(buildWorkspace());

      const result = await service.cleanup('user-1', 'project-1');

      expect(paths.removeWorkspaceDirectory).toHaveBeenCalledWith(
        '/workspaces/project-1',
      );
      expect(result.status).toBe(WorkspaceStatus.NOT_PREPARED);
    });

    it('resets a FAILED workspace with no directory on disk without touching Git', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue(
        buildWorkspace({
          status: WorkspaceStatus.FAILED,
          workspacePath: '/workspaces/project-1',
        }),
      );
      paths.exists.mockResolvedValue(false);
      prisma.projectWorkspace.update.mockResolvedValue(buildWorkspace());

      await service.cleanup('user-1', 'project-1');

      expect(git.getStatus).not.toHaveBeenCalled();
      expect(paths.removeWorkspaceDirectory).not.toHaveBeenCalled();
    });
  });
});
