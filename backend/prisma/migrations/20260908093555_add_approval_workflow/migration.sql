-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('ANALYSIS', 'ARCHITECTURE', 'SPRINT_PLAN', 'START_DEVELOPMENT');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ApprovalArtifactType" AS ENUM ('PROJECT_ANALYSIS', 'ARCHITECTURE', 'SPRINT_PLAN', 'PROJECT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectStatus" ADD VALUE 'ANALYSIS_APPROVED';
ALTER TYPE "ProjectStatus" ADD VALUE 'ARCHITECTURE_READY';
ALTER TYPE "ProjectStatus" ADD VALUE 'ARCHITECTURE_APPROVED';
ALTER TYPE "ProjectStatus" ADD VALUE 'PLAN_APPROVED';
ALTER TYPE "ProjectStatus" ADD VALUE 'DEVELOPMENT_APPROVED';

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "ApprovalStage" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "artifactType" "ApprovalArtifactType" NOT NULL,
    "projectAnalysisId" TEXT,
    "architectureId" TEXT,
    "sprintPlanId" TEXT,
    "comment" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvals_projectId_stage_decidedAt_idx" ON "approvals"("projectId", "stage", "decidedAt");

-- CreateIndex
CREATE INDEX "approvals_projectAnalysisId_idx" ON "approvals"("projectAnalysisId");

-- CreateIndex
CREATE INDEX "approvals_architectureId_idx" ON "approvals"("architectureId");

-- CreateIndex
CREATE INDEX "approvals_sprintPlanId_idx" ON "approvals"("sprintPlanId");

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_projectAnalysisId_fkey" FOREIGN KEY ("projectAnalysisId") REFERENCES "project_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_architectureId_fkey" FOREIGN KEY ("architectureId") REFERENCES "architectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_sprintPlanId_fkey" FOREIGN KEY ("sprintPlanId") REFERENCES "sprint_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
