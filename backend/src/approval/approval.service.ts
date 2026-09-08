import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Approval,
  ApprovalArtifactType,
  ApprovalDecision,
  ApprovalStage,
  Prisma,
  Project,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalError, ApprovalErrorCode } from './errors/approval.error';
import { mapApprovalErrorToHttpException } from './errors/approval-error.mapper';
import {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalSummary,
} from './types/approval.types';

type ArtifactFkField = 'projectAnalysisId' | 'architectureId' | 'sprintPlanId';

const ARTIFACT_FK_BY_STAGE: Record<
  Exclude<ApprovalStage, 'START_DEVELOPMENT'>,
  ArtifactFkField
> = {
  ANALYSIS: 'projectAnalysisId',
  ARCHITECTURE: 'architectureId',
  SPRINT_PLAN: 'sprintPlanId',
};

const ARTIFACT_TYPE_BY_STAGE: Record<ApprovalStage, ApprovalArtifactType> = {
  ANALYSIS: ApprovalArtifactType.PROJECT_ANALYSIS,
  ARCHITECTURE: ApprovalArtifactType.ARCHITECTURE,
  SPRINT_PLAN: ApprovalArtifactType.SPRINT_PLAN,
  START_DEVELOPMENT: ApprovalArtifactType.PROJECT,
};

// Every read that needs to show "which version was this decision about"
// joins all three optional artifact relations (only one is ever populated
// per row) rather than storing a denormalized version column — the FK
// itself is the single source of truth for which exact row was reviewed.
const ARTIFACT_VERSION_INCLUDE = {
  projectAnalysis: { select: { version: true } },
  architecture: { select: { version: true } },
  sprintPlan: { select: { version: true } },
} satisfies Prisma.ApprovalInclude;

type ApprovalWithArtifactVersions = Approval & {
  projectAnalysis: { version: number } | null;
  architecture: { version: number } | null;
  sprintPlan: { version: number } | null;
};

function resolveArtifactVersion(
  row: ApprovalWithArtifactVersions,
): number | null {
  return (
    row.projectAnalysis?.version ??
    row.architecture?.version ??
    row.sprintPlan?.version ??
    null
  );
}

function toRecord(row: ApprovalWithArtifactVersions): ApprovalRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    stage: row.stage,
    decision: row.decision,
    artifactType: row.artifactType,
    artifactVersion: resolveArtifactVersion(row),
    comment: row.comment,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

// Dedicated home for every approval decision, gate check, and audit read —
// Analysis/Architecture/SprintPlan services call into this rather than each
// growing their own copy of approval logic.
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  // ---- exact-current-version approval checks (source of truth) ----------

  async isCurrentAnalysisApproved(projectId: string): Promise<boolean> {
    const analysis = await this.prisma.projectAnalysis.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!analysis) return false;
    return this.isArtifactApproved(
      ApprovalStage.ANALYSIS,
      'projectAnalysisId',
      analysis.id,
    );
  }

  async isCurrentArchitectureApproved(projectId: string): Promise<boolean> {
    const architecture = await this.prisma.architecture.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!architecture) return false;
    return this.isArtifactApproved(
      ApprovalStage.ARCHITECTURE,
      'architectureId',
      architecture.id,
    );
  }

  async isCurrentSprintPlanApproved(projectId: string): Promise<boolean> {
    const sprintPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!sprintPlan) return false;
    return this.isArtifactApproved(
      ApprovalStage.SPRINT_PLAN,
      'sprintPlanId',
      sprintPlan.id,
    );
  }

  private async isArtifactApproved(
    stage: ApprovalStage,
    fkField: ArtifactFkField,
    artifactId: string,
  ): Promise<boolean> {
    const latest = await this.prisma.approval.findFirst({
      where: { stage, [fkField]: artifactId },
      orderBy: { decidedAt: 'desc' },
      select: { decision: true },
    });
    return latest?.decision === ApprovalDecision.APPROVED;
  }

  // The reusable execution gate future development-execution sprints must
  // call before running any agent/task. Always re-derives freshness live
  // (no stored snapshot to go stale) — if any upstream artifact has been
  // edited/regenerated since Start Development was approved, this fails
  // immediately rather than trusting a decision that no longer matches
  // current planning state.
  async assertDevelopmentApproved(projectId: string): Promise<void> {
    const [analysisApproved, architectureApproved, sprintPlanApproved] =
      await Promise.all([
        this.isCurrentAnalysisApproved(projectId),
        this.isCurrentArchitectureApproved(projectId),
        this.isCurrentSprintPlanApproved(projectId),
      ]);

    if (!analysisApproved || !architectureApproved || !sprintPlanApproved) {
      throw new ApprovalError({
        code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
        message:
          'Development is not approved: current Analysis, Architecture, and Sprint Plan must all be approved.',
      });
    }

    const latestStartDevelopment = await this.prisma.approval.findFirst({
      where: { projectId, stage: ApprovalStage.START_DEVELOPMENT },
      orderBy: { decidedAt: 'desc' },
      select: { decision: true },
    });

    if (latestStartDevelopment?.decision !== ApprovalDecision.APPROVED) {
      throw new ApprovalError({
        code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
        message: 'Development has not been explicitly approved to start.',
      });
    }
  }

  // ---- reads ---------------------------------------------------------

  async getCurrentStatus(
    userId: string,
    projectId: string,
    stage: ApprovalStage,
  ): Promise<ApprovalStatus> {
    await this.projectsService.findOneForUser(userId, projectId);
    return this.resolveCurrentStatus(projectId, stage);
  }

  private async resolveCurrentStatus(
    projectId: string,
    stage: ApprovalStage,
  ): Promise<ApprovalStatus> {
    if (stage === ApprovalStage.START_DEVELOPMENT) {
      const latest = await this.prisma.approval.findFirst({
        where: { projectId, stage },
        orderBy: { decidedAt: 'desc' },
      });
      return {
        stage,
        currentVersion: null,
        decision: latest?.decision ?? null,
        comment: latest?.comment ?? null,
        decidedAt: latest?.decidedAt ?? null,
        decidedByUserId: latest?.decidedByUserId ?? null,
      };
    }

    const fkField = ARTIFACT_FK_BY_STAGE[stage];
    const artifact = await this.findCurrentArtifact(projectId, stage);
    if (!artifact) {
      return {
        stage,
        currentVersion: null,
        decision: null,
        comment: null,
        decidedAt: null,
        decidedByUserId: null,
      };
    }

    const latest = await this.prisma.approval.findFirst({
      where: { projectId, stage, [fkField]: artifact.id },
      orderBy: { decidedAt: 'desc' },
    });

    return {
      stage,
      currentVersion: artifact.version,
      decision: latest?.decision ?? null,
      comment: latest?.comment ?? null,
      decidedAt: latest?.decidedAt ?? null,
      decidedByUserId: latest?.decidedByUserId ?? null,
    };
  }

  async getHistory(
    userId: string,
    projectId: string,
    stage?: ApprovalStage,
  ): Promise<ApprovalRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    const rows = await this.prisma.approval.findMany({
      where: { projectId, ...(stage ? { stage } : {}) },
      orderBy: { decidedAt: 'desc' },
      include: ARTIFACT_VERSION_INCLUDE,
    });
    return rows.map(toRecord);
  }

  async getSummary(
    userId: string,
    projectId: string,
  ): Promise<ApprovalSummary> {
    await this.projectsService.findOneForUser(userId, projectId);
    const [analysis, architecture, sprintPlan, startDevelopment] =
      await Promise.all([
        this.resolveCurrentStatus(projectId, ApprovalStage.ANALYSIS),
        this.resolveCurrentStatus(projectId, ApprovalStage.ARCHITECTURE),
        this.resolveCurrentStatus(projectId, ApprovalStage.SPRINT_PLAN),
        this.resolveCurrentStatus(projectId, ApprovalStage.START_DEVELOPMENT),
      ]);

    const toEntry = (status: ApprovalStatus) => ({
      decision: status.decision,
      version: status.currentVersion,
      decidedAt: status.decidedAt,
    });

    return {
      analysis: toEntry(analysis),
      architecture: toEntry(architecture),
      sprintPlan: toEntry(sprintPlan),
      startDevelopment: toEntry(startDevelopment),
    };
  }

  // ---- decisions -------------------------------------------------------

  async decide(
    userId: string,
    projectId: string,
    stage: ApprovalStage,
    dto: { decision: ApprovalDecision; comment?: string },
  ): Promise<ApprovalRecord> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);

    const comment = dto.comment?.trim() || null;
    if (dto.decision === ApprovalDecision.CHANGES_REQUESTED && !comment) {
      throw mapApprovalErrorToHttpException(
        new ApprovalError({
          code: ApprovalErrorCode.CHANGES_COMMENT_REQUIRED,
          message: 'A comment is required when requesting changes.',
        }),
      );
    }

    try {
      switch (stage) {
        case ApprovalStage.ANALYSIS:
          return await this.decideAnalysis(
            userId,
            project,
            dto.decision,
            comment,
          );
        case ApprovalStage.ARCHITECTURE:
          return await this.decideArchitecture(
            userId,
            project,
            dto.decision,
            comment,
          );
        case ApprovalStage.SPRINT_PLAN:
          return await this.decideSprintPlan(
            userId,
            project,
            dto.decision,
            comment,
          );
        case ApprovalStage.START_DEVELOPMENT:
          if (dto.decision === ApprovalDecision.CHANGES_REQUESTED) {
            throw new BadRequestException(
              'Start Development can only be approved.',
            );
          }
          return await this.decideStartDevelopment(userId, project, comment);
        default:
          throw new BadRequestException(
            `Unknown approval stage: ${String(stage)}`,
          );
      }
    } catch (error) {
      if (error instanceof ApprovalError) {
        throw mapApprovalErrorToHttpException(error);
      }
      throw error;
    }
  }

  private async decideAnalysis(
    userId: string,
    project: Project,
    decision: ApprovalDecision,
    comment: string | null,
  ): Promise<ApprovalRecord> {
    const analysis = await this.prisma.projectAnalysis.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!analysis) {
      throw new ApprovalError({
        code: ApprovalErrorCode.CURRENT_VERSION_MISSING,
        message: 'No current Project Analysis exists to approve.',
      });
    }

    return this.persistDecision({
      userId,
      projectId: project.id,
      stage: ApprovalStage.ANALYSIS,
      decision,
      fkField: 'projectAnalysisId',
      artifactId: analysis.id,
      comment,
      onApprove: async (tx) => {
        if (project.status === ProjectStatus.ANALYSIS_READY) {
          await tx.project.update({
            where: { id: project.id },
            data: { status: ProjectStatus.ANALYSIS_APPROVED },
          });
        }
      },
    });
  }

  private async decideArchitecture(
    userId: string,
    project: Project,
    decision: ApprovalDecision,
    comment: string | null,
  ): Promise<ApprovalRecord> {
    const architecture = await this.prisma.architecture.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!architecture) {
      throw new ApprovalError({
        code: ApprovalErrorCode.CURRENT_VERSION_MISSING,
        message: 'No current Architecture exists to approve.',
      });
    }

    if (decision === ApprovalDecision.APPROVED) {
      const analysisApproved = await this.isCurrentAnalysisApproved(project.id);
      if (!analysisApproved) {
        throw new ApprovalError({
          code: ApprovalErrorCode.PREREQUISITE_MISSING,
          message:
            'Current Project Analysis must be approved before approving Architecture.',
        });
      }
    }

    return this.persistDecision({
      userId,
      projectId: project.id,
      stage: ApprovalStage.ARCHITECTURE,
      decision,
      fkField: 'architectureId',
      artifactId: architecture.id,
      comment,
      onApprove: async (tx) => {
        if (project.status === ProjectStatus.ARCHITECTURE_READY) {
          await tx.project.update({
            where: { id: project.id },
            data: { status: ProjectStatus.ARCHITECTURE_APPROVED },
          });
        }
      },
    });
  }

  private async decideSprintPlan(
    userId: string,
    project: Project,
    decision: ApprovalDecision,
    comment: string | null,
  ): Promise<ApprovalRecord> {
    const sprintPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!sprintPlan) {
      throw new ApprovalError({
        code: ApprovalErrorCode.CURRENT_VERSION_MISSING,
        message: 'No current Sprint Plan exists to approve.',
      });
    }

    if (decision === ApprovalDecision.APPROVED) {
      const [analysisApproved, architectureApproved] = await Promise.all([
        this.isCurrentAnalysisApproved(project.id),
        this.isCurrentArchitectureApproved(project.id),
      ]);
      if (!analysisApproved || !architectureApproved) {
        throw new ApprovalError({
          code: ApprovalErrorCode.PREREQUISITE_MISSING,
          message:
            'Current Project Analysis and Architecture must both be approved before approving the Sprint Plan.',
        });
      }
    }

    return this.persistDecision({
      userId,
      projectId: project.id,
      stage: ApprovalStage.SPRINT_PLAN,
      decision,
      fkField: 'sprintPlanId',
      artifactId: sprintPlan.id,
      comment,
      onApprove: async (tx) => {
        if (project.status === ProjectStatus.PLAN_READY) {
          await tx.project.update({
            where: { id: project.id },
            data: { status: ProjectStatus.PLAN_APPROVED },
          });
        }
      },
    });
  }

  private async decideStartDevelopment(
    userId: string,
    project: Project,
    comment: string | null,
  ): Promise<ApprovalRecord> {
    const [analysisApproved, architectureApproved, sprintPlanApproved] =
      await Promise.all([
        this.isCurrentAnalysisApproved(project.id),
        this.isCurrentArchitectureApproved(project.id),
        this.isCurrentSprintPlanApproved(project.id),
      ]);
    if (!analysisApproved || !architectureApproved || !sprintPlanApproved) {
      throw new ApprovalError({
        code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
        message:
          'Current Analysis, Architecture, and Sprint Plan must all be approved before approving Start Development.',
      });
    }

    return this.persistDecision({
      userId,
      projectId: project.id,
      stage: ApprovalStage.START_DEVELOPMENT,
      decision: ApprovalDecision.APPROVED,
      fkField: null,
      artifactId: null,
      comment,
      onApprove: async (tx) => {
        if (project.status === ProjectStatus.PLAN_APPROVED) {
          await tx.project.update({
            where: { id: project.id },
            data: { status: ProjectStatus.DEVELOPMENT_APPROVED },
          });
        }
      },
    });
  }

  private async persistDecision(params: {
    userId: string;
    projectId: string;
    stage: ApprovalStage;
    decision: ApprovalDecision;
    fkField: ArtifactFkField | null;
    artifactId: string | null;
    comment: string | null;
    onApprove?: (tx: Prisma.TransactionClient) => Promise<void>;
  }): Promise<ApprovalRecord> {
    const whereFk =
      params.fkField && params.artifactId
        ? { [params.fkField]: params.artifactId }
        : {};

    // Idempotency: a double-click / retried request that would produce the
    // exact same decision (same stage, same version, same decision, same
    // comment) returns the existing row rather than appending a duplicate.
    const latest = await this.prisma.approval.findFirst({
      where: { projectId: params.projectId, stage: params.stage, ...whereFk },
      orderBy: { decidedAt: 'desc' },
      include: ARTIFACT_VERSION_INCLUDE,
    });
    if (
      latest &&
      latest.decision === params.decision &&
      (latest.comment ?? null) === params.comment
    ) {
      return toRecord(latest);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Re-verify the artifact is still the current version inside the same
      // transaction as the write, narrowing the race window against a
      // concurrent edit/regenerate superseding it mid-request (see item 20:
      // client-supplied versions are never trusted, but a version resolved
      // moments ago could still be overtaken by a concurrent write).
      if (params.fkField && params.artifactId) {
        const stillCurrent = await this.isArtifactStillCurrent(
          tx,
          params.stage,
          params.artifactId,
        );
        if (!stillCurrent) {
          throw new ApprovalError({
            code: ApprovalErrorCode.VERSION_STALE,
            message:
              'This version is no longer current. Refresh and try again.',
          });
        }
      }

      const row = await tx.approval.create({
        data: {
          projectId: params.projectId,
          stage: params.stage,
          decision: params.decision,
          artifactType: ARTIFACT_TYPE_BY_STAGE[params.stage],
          projectAnalysisId:
            params.fkField === 'projectAnalysisId' ? params.artifactId : null,
          architectureId:
            params.fkField === 'architectureId' ? params.artifactId : null,
          sprintPlanId:
            params.fkField === 'sprintPlanId' ? params.artifactId : null,
          comment: params.comment,
          decidedByUserId: params.userId,
        },
        include: ARTIFACT_VERSION_INCLUDE,
      });

      if (params.decision === ApprovalDecision.APPROVED && params.onApprove) {
        await params.onApprove(tx);
      }

      return row;
    });

    this.logger.log(
      `Approval decision recorded (projectId=${params.projectId}, stage=${params.stage}, decision=${params.decision})`,
    );

    return toRecord(created);
  }

  private async isArtifactStillCurrent(
    tx: Prisma.TransactionClient,
    stage: ApprovalStage,
    artifactId: string,
  ): Promise<boolean> {
    switch (stage) {
      case ApprovalStage.ANALYSIS: {
        const current = await tx.projectAnalysis.findUnique({
          where: { id: artifactId },
          select: { projectId: true },
        });
        if (!current) return false;
        const latest = await tx.projectAnalysis.findFirst({
          where: { projectId: current.projectId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        return latest?.id === artifactId;
      }
      case ApprovalStage.ARCHITECTURE: {
        const current = await tx.architecture.findUnique({
          where: { id: artifactId },
          select: { projectId: true },
        });
        if (!current) return false;
        const latest = await tx.architecture.findFirst({
          where: { projectId: current.projectId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        return latest?.id === artifactId;
      }
      case ApprovalStage.SPRINT_PLAN: {
        const current = await tx.sprintPlan.findUnique({
          where: { id: artifactId },
          select: { projectId: true },
        });
        if (!current) return false;
        const latest = await tx.sprintPlan.findFirst({
          where: { projectId: current.projectId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        return latest?.id === artifactId;
      }
      default:
        return true;
    }
  }

  private async findCurrentArtifact(
    projectId: string,
    stage: Exclude<ApprovalStage, 'START_DEVELOPMENT'>,
  ): Promise<{ id: string; version: number } | null> {
    switch (stage) {
      case ApprovalStage.ANALYSIS:
        return this.prisma.projectAnalysis.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
      case ApprovalStage.ARCHITECTURE:
        return this.prisma.architecture.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
      case ApprovalStage.SPRINT_PLAN:
        return this.prisma.sprintPlan.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
    }
  }

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot record approvals for an archived project. Restore the project first.',
      );
    }
  }
}
