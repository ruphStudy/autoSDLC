-- CreateEnum
CREATE TYPE "SprintExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'SPRINT_EXECUTION';

-- CreateTable
CREATE TABLE "sprint_executions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "sprintPlanId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "SprintExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "currentTaskId" TEXT,
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "passedTasks" INTEGER NOT NULL DEFAULT 0,
    "failedTasks" INTEGER NOT NULL DEFAULT 0,
    "blockedTasks" INTEGER NOT NULL DEFAULT 0,
    "repositoryStartSha" TEXT,
    "repositoryEndSha" TEXT,
    "backgroundJobId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sprint_executions_backgroundJobId_key" ON "sprint_executions"("backgroundJobId");

-- CreateIndex
CREATE INDEX "sprint_executions_projectId_createdAt_idx" ON "sprint_executions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "sprint_executions_sprintId_idx" ON "sprint_executions"("sprintId");

-- CreateIndex
CREATE INDEX "sprint_executions_status_idx" ON "sprint_executions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_executions_sprintId_attempt_key" ON "sprint_executions"("sprintId", "attempt");

-- AddForeignKey
ALTER TABLE "sprint_executions" ADD CONSTRAINT "sprint_executions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_executions" ADD CONSTRAINT "sprint_executions_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
