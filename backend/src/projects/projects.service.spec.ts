import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectStatus, RepositoryType, WorkspaceStatus } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'project-1',
    userId: 'user-1',
    name: 'Interview Prep Platform',
    description: null,
    brief: 'Build a mock interview platform.',
    preferredStack: null,
    repositoryType: RepositoryType.NEW,
    repositoryUrl: null,
    status: ProjectStatus.DRAFT,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ProjectsService', () => {
  let prisma: {
    project: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    projectWorkspace: {
      findUnique: jest.Mock;
    };
    sprintExecution: {
      findFirst: jest.Mock;
    };
  };
  let config: { get: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    prisma = {
      project: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      projectWorkspace: {
        findUnique: jest.fn(),
      },
      sprintExecution: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    config = { get: jest.fn() };
    service = new ProjectsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  describe('create', () => {
    it('always creates with DRAFT status', async () => {
      prisma.project.create.mockResolvedValue(buildProject());

      await service.create('user-1', {
        name: 'Interview Prep Platform',
        brief: 'Build a mock interview platform.',
      });

      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProjectStatus.DRAFT,
            userId: 'user-1',
          }),
        }),
      );
    });

    it('clears repositoryUrl when repositoryType is NEW even if a URL was supplied', async () => {
      prisma.project.create.mockResolvedValue(buildProject());

      await service.create('user-1', {
        name: 'X',
        brief: 'Y',
        repositoryType: RepositoryType.NEW,
        repositoryUrl: 'https://github.com/example/repo',
      });

      const createArgs = prisma.project.create.mock.calls[0][0];
      expect(createArgs.data.repositoryUrl).toBeNull();
    });

    it('keeps repositoryUrl when repositoryType is EXISTING', async () => {
      prisma.project.create.mockResolvedValue(buildProject());

      await service.create('user-1', {
        name: 'X',
        brief: 'Y',
        repositoryType: RepositoryType.EXISTING,
        repositoryUrl: 'https://github.com/example/repo',
      });

      const createArgs = prisma.project.create.mock.calls[0][0];
      expect(createArgs.data.repositoryUrl).toBe(
        'https://github.com/example/repo',
      );
    });
  });

  describe('findAllForUser', () => {
    it('filters to active projects by default', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.findAllForUser('user-1', 'active');

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', archivedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
    });

    it('filters to archived projects', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.findAllForUser('user-1', 'archived');

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', archivedAt: { not: null } },
        orderBy: { updatedAt: 'desc' },
      });
    });

    it('returns everything for "all"', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.findAllForUser('user-1', 'all');

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

  describe('ownership', () => {
    it('throws NotFoundException when the project does not belong to the user', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForUser('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: 'project-1', userId: 'user-1' },
      });
    });

    it('rejects update/archive/restore/delete on a non-owned project', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'project-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.archive('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.restore('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.remove('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('clears repositoryUrl when switching repositoryType to NEW', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: 'https://x',
        }),
      );
      prisma.project.update.mockResolvedValue(buildProject());

      await service.update('user-1', 'project-1', {
        repositoryType: RepositoryType.NEW,
      });

      const updateArgs = prisma.project.update.mock.calls[0][0];
      expect(updateArgs.data.repositoryUrl).toBeNull();
    });

    it('preserves fields not present in the DTO', async () => {
      const existing = buildProject({ preferredStack: 'React + NestJS' });
      prisma.project.findFirst.mockResolvedValue(existing);
      prisma.project.update.mockResolvedValue(existing);

      await service.update('user-1', 'project-1', { name: 'New Name' });

      const updateArgs = prisma.project.update.mock.calls[0][0];
      expect(updateArgs.data.preferredStack).toBe('React + NestJS');
      expect(updateArgs.data.name).toBe('New Name');
    });

    it('allows changes unrelated to repository config even if a workspace exists', async () => {
      prisma.project.findFirst.mockResolvedValue(buildProject());
      prisma.project.update.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        status: WorkspaceStatus.READY,
      });

      await expect(
        service.update('user-1', 'project-1', { name: 'New Name' }),
      ).resolves.toBeDefined();
      expect(prisma.project.update).toHaveBeenCalled();
    });

    it('rejects a repository configuration change while a prepared workspace exists', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.NEW,
          repositoryUrl: null,
        }),
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        status: WorkspaceStatus.READY,
      });

      await expect(
        service.update('user-1', 'project-1', {
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: 'https://example.com/org/repo.git',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('allows a repository configuration change when the workspace is NOT_PREPARED', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({
          repositoryType: RepositoryType.NEW,
          repositoryUrl: null,
        }),
      );
      prisma.project.update.mockResolvedValue(buildProject());
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        status: WorkspaceStatus.NOT_PREPARED,
      });

      await expect(
        service.update('user-1', 'project-1', {
          repositoryType: RepositoryType.EXISTING,
          repositoryUrl: 'https://example.com/org/repo.git',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('archive / restore', () => {
    it('archives an active project', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({ archivedAt: null }),
      );
      prisma.project.update.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      const result = await service.archive('user-1', 'project-1');

      expect(prisma.project.update).toHaveBeenCalled();
      expect(result.archivedAt).not.toBeNull();
    });

    it('is idempotent when archiving an already-archived project', async () => {
      const archived = buildProject({ archivedAt: new Date() });
      prisma.project.findFirst.mockResolvedValue(archived);

      const result = await service.archive('user-1', 'project-1');

      expect(prisma.project.update).not.toHaveBeenCalled();
      expect(result).toBe(archived);
    });

    it('is idempotent when restoring an active project', async () => {
      const active = buildProject({ archivedAt: null });
      prisma.project.findFirst.mockResolvedValue(active);

      const result = await service.restore('user-1', 'project-1');

      expect(prisma.project.update).not.toHaveBeenCalled();
      expect(result).toBe(active);
    });

    it('restores an archived project', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      prisma.project.update.mockResolvedValue(
        buildProject({ archivedAt: null }),
      );

      const result = await service.restore('user-1', 'project-1');

      expect(result.archivedAt).toBeNull();
    });

    it('blocks archiving while a Sprint execution is active', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({ archivedAt: null }),
      );
      prisma.sprintExecution.findFirst.mockResolvedValue({ id: 'exec-1' });

      await expect(
        service.archive('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned project', async () => {
      prisma.project.findFirst.mockResolvedValue(buildProject());
      prisma.project.delete.mockResolvedValue(buildProject());
      config.get.mockReturnValue(undefined);

      const result = await service.remove('user-1', 'project-1');

      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: 'project-1' },
      });
      expect(result).toEqual({ success: true });
    });

    it('blocks deleting while a Sprint execution is active', async () => {
      prisma.project.findFirst.mockResolvedValue(buildProject());
      prisma.sprintExecution.findFirst.mockResolvedValue({ id: 'exec-1' });

      await expect(
        service.remove('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });

    it('succeeds even if best-effort workspace cleanup fails', async () => {
      prisma.project.findFirst.mockResolvedValue(buildProject());
      prisma.project.delete.mockResolvedValue(buildProject());
      // An invalid (non-UUID) id makes resolveProjectWorkspacePath throw —
      // deletion must not fail because of it.
      config.get.mockReturnValue('/tmp/autosdlc-workspaces');

      const result = await service.remove('user-1', 'project-1');

      expect(result).toEqual({ success: true });
    });
  });

  describe('transitionStatus', () => {
    it('transitions when the current status matches expectations', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({ status: ProjectStatus.DRAFT }),
      );
      prisma.project.update.mockResolvedValue(
        buildProject({ status: ProjectStatus.ANALYZING }),
      );

      const result = await service.transitionStatus(
        'user-1',
        'project-1',
        ProjectStatus.DRAFT,
        ProjectStatus.ANALYZING,
      );

      expect(result.status).toBe(ProjectStatus.ANALYZING);
    });

    it('rejects the transition when the current status does not match', async () => {
      prisma.project.findFirst.mockResolvedValue(
        buildProject({ status: ProjectStatus.ANALYZING }),
      );

      await expect(
        service.transitionStatus(
          'user-1',
          'project-1',
          ProjectStatus.DRAFT,
          ProjectStatus.ANALYZING,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
