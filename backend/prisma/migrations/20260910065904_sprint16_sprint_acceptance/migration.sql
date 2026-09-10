-- CreateEnum
CREATE TYPE "SprintAcceptanceStatus" AS ENUM ('PENDING', 'REVIEWING', 'READY_FOR_DECISION', 'ACCEPTED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SprintAcceptanceRecommendation" AS ENUM ('ACCEPT', 'ACCEPT_WITH_NOTES', 'NEEDS_ATTENTION', 'REJECT');

-- CreateTable
CREATE TABLE "sprint_acceptances" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "sprintPlanId" TEXT NOT NULL,
    "sprintExecutionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SprintAcceptanceStatus" NOT NULL DEFAULT 'PENDING',
    "deterministicPassed" BOOLEAN NOT NULL DEFAULT true,
    "deterministicSummary" TEXT,
    "requirementCoverage" JSONB,
    "validationSummary" JSONB,
    "commitSummary" JSONB,
    "riskSummary" JSONB,
    "changedFiles" JSONB,
    "repositoryHeadSha" TEXT,
    "evidenceHash" TEXT,
    "aiReviewStatus" TEXT,
    "aiSummary" TEXT,
    "objectiveAssessment" JSONB,
    "architectureAssessment" JSONB,
    "riskAssessment" JSONB,
    "findings" JSONB,
    "recommendation" "SprintAcceptanceRecommendation",
    "promptName" TEXT,
    "promptVersion" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "latencyMs" INTEGER,
    "attempts" INTEGER,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewerNotes" TEXT,
    "backgroundJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sprint_acceptances_backgroundJobId_key" ON "sprint_acceptances"("backgroundJobId");

-- CreateIndex
CREATE INDEX "sprint_acceptances_projectId_createdAt_idx" ON "sprint_acceptances"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "sprint_acceptances_sprintId_idx" ON "sprint_acceptances"("sprintId");

-- CreateIndex
CREATE INDEX "sprint_acceptances_sprintExecutionId_idx" ON "sprint_acceptances"("sprintExecutionId");

-- CreateIndex
CREATE INDEX "sprint_acceptances_status_idx" ON "sprint_acceptances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_acceptances_sprintId_version_key" ON "sprint_acceptances"("sprintId", "version");

-- AddForeignKey
ALTER TABLE "sprint_acceptances" ADD CONSTRAINT "sprint_acceptances_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_acceptances" ADD CONSTRAINT "sprint_acceptances_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_acceptances" ADD CONSTRAINT "sprint_acceptances_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
