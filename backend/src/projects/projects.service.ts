import * as fs from 'node:fs/promises';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Project,
  ProjectStatus,
  RepositoryType,
  WorkspaceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ArchivedFilter } from './types/project.types';
import { resolveProjectWorkspacePath } from '../workspace/workspace-path.util';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Every mutating/reading operation below goes through this, so ownership
  // can never accidentally be skipped: a project that isn't the caller's
  // simply doesn't exist as far as the response is concerned (404, not 403 —
  // a 403 would confirm the id belongs to someone else).
  private async findOwnedProjectOrThrow(
    userId: string,
    id: string,
  ): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id, userId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  // Reads the sprintExecution table directly via the already-injected
  // PrismaService rather than importing SprintExecutionModule (same
  // precedent as the projectWorkspace check below and ApprovalService
  // reading ProjectAnalysis/Architecture/SprintPlan directly) — archiving
  // or permanently deleting a project out from under a live autonomous
  // Sprint execution would pull the workspace directory (and, for delete,
  // the Project row itself) out from under a running coding agent (item
  // 134/135).
  private async assertNoActiveSprintExecution(
    projectId: string,
  ): Promise<void> {
    const active = await this.prisma.sprintExecution.findFirst({
      where: {
        projectId,
        status: { in: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'] },
      },
    });
    if (active) {
      throw new ConflictException(
        'Cannot archive or delete this project while a Sprint execution is active. Cancel it first.',
      );
    }
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const repositoryType = dto.repositoryType ?? RepositoryType.NEW;

    const project = await this.prisma.project.create({
      data: {
        userId,
        name: dto.name,
        brief: dto.brief,
        description: dto.description ?? null,
        preferredStack: dto.preferredStack ?? null,
        repositoryType,
        repositoryUrl:
          repositoryType === RepositoryType.NEW
            ? null
            : (dto.repositoryUrl ?? null),
        status: ProjectStatus.DRAFT,
      },
    });

    this.logger.log(`Project created (id=${project.id}, userId=${userId})`);
    return project;
  }

  async findAllForUser(
    userId: string,
    archived: ArchivedFilter,
  ): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: {
        userId,
        ...(archived === 'active' && { archivedAt: null }),
        ...(archived === 'archived' && { archivedAt: { not: null } }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOneForUser(userId: string, id: string): Promise<Project> {
    return this.findOwnedProjectOrThrow(userId, id);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const existing = await this.findOwnedProjectOrThrow(userId, id);

    const nextRepositoryType = dto.repositoryType ?? existing.repositoryType;
    // Switching to NEW clears any previously stored URL: it no longer means
    // anything once there's no existing repository being connected.
    const repositoryUrl =
      nextRepositoryType === RepositoryType.NEW
        ? null
        : (dto.repositoryUrl ?? existing.repositoryUrl);

    const repositoryConfigChanged =
      nextRepositoryType !== existing.repositoryType ||
      repositoryUrl !== existing.repositoryUrl;

    if (repositoryConfigChanged) {
      // Approval records and Git history are keyed to "this project's
      // repository" — swapping it out from under a prepared workspace would
      // silently orphan that state. Workspace metadata is the source of
      // truth here (see workspace/ — Sprint 9), read directly rather than
      // importing WorkspaceModule, to keep the module graph one-directional.
      const workspace = await this.prisma.projectWorkspace.findUnique({
        where: { projectId: id },
      });
      if (workspace && workspace.status !== WorkspaceStatus.NOT_PREPARED) {
        throw new ConflictException(
          'Clean up or reprepare the workspace before changing repository configuration.',
        );
      }
    }

    const project = await this.prisma.project.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        brief: dto.brief ?? existing.brief,
        description: dto.description ?? existing.description,
        preferredStack: dto.preferredStack ?? existing.preferredStack,
        repositoryType: nextRepositoryType,
        repositoryUrl,
      },
    });

    return project;
  }

  async archive(userId: string, id: string): Promise<Project> {
    const existing = await this.findOwnedProjectOrThrow(userId, id);
    if (existing.archivedAt) {
      return existing;
    }
    await this.assertNoActiveSprintExecution(existing.id);

    const project = await this.prisma.project.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });

    this.logger.log(`Project archived (id=${project.id}, userId=${userId})`);
    return project;
  }

  async restore(userId: string, id: string): Promise<Project> {
    const existing = await this.findOwnedProjectOrThrow(userId, id);
    if (!existing.archivedAt) {
      return existing;
    }

    const project = await this.prisma.project.update({
      where: { id: existing.id },
      data: { archivedAt: null },
    });

    this.logger.log(`Project restored (id=${project.id}, userId=${userId})`);
    return project;
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    const existing = await this.findOwnedProjectOrThrow(userId, id);
    await this.assertNoActiveSprintExecution(existing.id);
    await this.prisma.project.delete({ where: { id: existing.id } });

    this.logger.log(`Project deleted (id=${existing.id}, userId=${userId})`);

    // Best-effort only: the Project row (and its ProjectWorkspace metadata
    // row, via cascade) is already gone. A leftover workspace directory is a
    // disk-space nit to clean up, never a reason to fail a delete that has
    // already committed.
    await this.cleanupWorkspaceDirectoryBestEffort(existing.id);

    return { success: true };
  }

  private async cleanupWorkspaceDirectoryBestEffort(
    projectId: string,
  ): Promise<void> {
    try {
      const root = this.config.get<string>('WORKSPACE_ROOT');
      if (!root) return;
      const target = resolveProjectWorkspacePath(root, projectId);
      await fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Workspace directory cleanup failed for deleted project ${projectId}: ${(error as Error).message}`,
      );
    }
  }

  // Not wired to any endpoint yet: this is the controlled entry point later
  // sprints (analysis, planning, execution) will use to move a project
  // through its workflow, so status changes stay auditable and race-safe
  // instead of a plain unchecked `update({ status })`.
  async transitionStatus(
    userId: string,
    id: string,
    expectedCurrentStatus: ProjectStatus,
    nextStatus: ProjectStatus,
  ): Promise<Project> {
    const existing = await this.findOwnedProjectOrThrow(userId, id);

    if (existing.status !== expectedCurrentStatus) {
      throw new ConflictException(
        `Project status is ${existing.status}, expected ${expectedCurrentStatus}`,
      );
    }

    const project = await this.prisma.project.update({
      where: { id: existing.id },
      data: { status: nextStatus },
    });

    this.logger.log(
      `Project status transitioned (id=${project.id}, ${expectedCurrentStatus} -> ${nextStatus})`,
    );
    return project;
  }
}
