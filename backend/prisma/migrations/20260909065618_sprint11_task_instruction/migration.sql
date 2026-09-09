-- CreateTable
CREATE TABLE "task_instructions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sprintPlanId" TEXT NOT NULL,
    "architectureId" TEXT NOT NULL,
    "projectAnalysisId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "repositoryObservations" JSONB NOT NULL,
    "implementationPlan" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "validationPlan" JSONB NOT NULL,
    "dependencyContext" JSONB NOT NULL,
    "risksOrWatchouts" JSONB NOT NULL,
    "finalInstruction" TEXT NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "repositoryHeadSha" TEXT NOT NULL,
    "repositoryBranch" TEXT,
    "promptName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_instructions_projectId_createdAt_idx" ON "task_instructions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "task_instructions_taskId_createdAt_idx" ON "task_instructions"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "task_instructions_taskId_version_key" ON "task_instructions"("taskId", "version");

-- AddForeignKey
ALTER TABLE "task_instructions" ADD CONSTRAINT "task_instructions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instructions" ADD CONSTRAINT "task_instructions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
