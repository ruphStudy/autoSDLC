-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CODING_AGENT_EXECUTION';

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "backgroundJobId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "instruction" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" TEXT,
    "changedFiles" JSONB,
    "toolActivities" JSONB,
    "commandActivities" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadInputTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "turns" INTEGER,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_jobs_backgroundJobId_key" ON "agent_jobs"("backgroundJobId");

-- CreateIndex
CREATE INDEX "agent_jobs_projectId_createdAt_idx" ON "agent_jobs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_jobs_taskId_idx" ON "agent_jobs"("taskId");

-- CreateIndex
CREATE INDEX "agent_jobs_status_idx" ON "agent_jobs"("status");

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
