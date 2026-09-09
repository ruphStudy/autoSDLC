-- CreateEnum
CREATE TYPE "ValidationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ValidationCheckType" AS ENUM ('LINT', 'TYPECHECK', 'UNIT_TEST', 'INTEGRATION_TEST', 'E2E_TEST', 'BUILD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ValidationAttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'TASK_VALIDATION';

-- AlterTable
ALTER TABLE "task_executions" ADD COLUMN     "commitSha" TEXT;

-- CreateTable
CREATE TABLE "validation_attempts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskExecutionId" TEXT NOT NULL,
    "backgroundJobId" TEXT,
    "attempt" INTEGER NOT NULL,
    "status" "ValidationAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requiredPassed" INTEGER NOT NULL DEFAULT 0,
    "requiredFailed" INTEGER NOT NULL DEFAULT 0,
    "optionalPassed" INTEGER NOT NULL DEFAULT 0,
    "optionalFailed" INTEGER NOT NULL DEFAULT 0,
    "commitSha" TEXT,
    "validatedDiffHash" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_runs" (
    "id" TEXT NOT NULL,
    "validationAttemptId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskExecutionId" TEXT NOT NULL,
    "type" "ValidationCheckType" NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "workingDirectory" TEXT,
    "status" "ValidationRunStatus" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL,
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "validation_attempts_backgroundJobId_key" ON "validation_attempts"("backgroundJobId");

-- CreateIndex
CREATE INDEX "validation_attempts_projectId_createdAt_idx" ON "validation_attempts"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "validation_attempts_taskId_idx" ON "validation_attempts"("taskId");

-- CreateIndex
CREATE INDEX "validation_attempts_status_idx" ON "validation_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "validation_attempts_taskId_attempt_key" ON "validation_attempts"("taskId", "attempt");

-- CreateIndex
CREATE INDEX "validation_runs_validationAttemptId_idx" ON "validation_runs"("validationAttemptId");

-- CreateIndex
CREATE INDEX "validation_runs_type_idx" ON "validation_runs"("type");

-- CreateIndex
CREATE INDEX "validation_runs_status_idx" ON "validation_runs"("status");

-- CreateIndex
CREATE INDEX "validation_runs_createdAt_idx" ON "validation_runs"("createdAt");

-- AddForeignKey
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_validationAttemptId_fkey" FOREIGN KEY ("validationAttemptId") REFERENCES "validation_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
