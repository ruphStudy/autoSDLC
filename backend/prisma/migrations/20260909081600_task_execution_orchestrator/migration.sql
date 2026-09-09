-- CreateEnum
CREATE TYPE "TaskExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'AGENT_COMPLETED', 'READY_FOR_VALIDATION', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'TASK_EXECUTION';

-- CreateTable
CREATE TABLE "task_executions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "TaskExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "priorTaskStatus" "TaskStatus",
    "taskInstructionId" TEXT,
    "agentJobId" TEXT,
    "backgroundJobId" TEXT,
    "repositoryStartSha" TEXT,
    "repositoryEndSha" TEXT,
    "changedFiles" JSONB,
    "gitDiff" TEXT,
    "gitDiffTruncated" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_executions_agentJobId_key" ON "task_executions"("agentJobId");

-- CreateIndex
CREATE UNIQUE INDEX "task_executions_backgroundJobId_key" ON "task_executions"("backgroundJobId");

-- CreateIndex
CREATE INDEX "task_executions_projectId_createdAt_idx" ON "task_executions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "task_executions_taskId_idx" ON "task_executions"("taskId");

-- CreateIndex
CREATE INDEX "task_executions_status_idx" ON "task_executions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "task_executions_taskId_attempt_key" ON "task_executions"("taskId", "attempt");

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
