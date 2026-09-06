import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Project, ProjectStatus, RepositoryType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ArchivedFilter } from './types/project.types';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.project.delete({ where: { id: existing.id } });

    this.logger.log(`Project deleted (id=${existing.id}, userId=${userId})`);
    return { success: true };
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
