-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_deliveries" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "repositoryFinalSha" TEXT NOT NULL,
    "repositoryBranch" TEXT,
    "requiredSprints" JSONB NOT NULL,
    "requirementCoverage" JSONB NOT NULL,
    "taskSummary" JSONB NOT NULL,
    "validationSummary" JSONB NOT NULL,
    "commitSummary" JSONB NOT NULL,
    "usageSummary" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "deliverySummary" TEXT NOT NULL,
    "deliveryEvidenceHash" TEXT NOT NULL,
    "finalizedByUserId" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_deliveries_projectId_createdAt_idx" ON "project_deliveries"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_deliveries_projectId_version_key" ON "project_deliveries"("projectId", "version");

-- AddForeignKey
ALTER TABLE "project_deliveries" ADD CONSTRAINT "project_deliveries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deliveries" ADD CONSTRAINT "project_deliveries_finalizedByUserId_fkey" FOREIGN KEY ("finalizedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
