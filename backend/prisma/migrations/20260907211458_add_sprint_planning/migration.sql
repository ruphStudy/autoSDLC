-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PENDING', 'RUNNING', 'TESTING', 'PASSED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'REVIEWING', 'PASSED', 'FAILED', 'BLOCKED');

-- CreateTable
CREATE TABLE "sprint_plans" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "architectureId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "AnalysisSource" NOT NULL,
    "basedOnVersion" INTEGER,
    "summary" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "estimatedSprintCount" INTEGER,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "sprintPlanId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "description" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'PENDING',
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_dependencies" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "dependsOnSprintId" TEXT NOT NULL,

    CONSTRAINT "sprint_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "sprintPlanId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "order" INTEGER NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "validationExpectations" JSONB NOT NULL,
    "requirementIds" JSONB NOT NULL,
    "architectureAreas" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprint_plans_projectId_createdAt_idx" ON "sprint_plans"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "sprint_plans_architectureId_idx" ON "sprint_plans"("architectureId");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_plans_projectId_version_key" ON "sprint_plans"("projectId", "version");

-- CreateIndex
CREATE INDEX "sprints_sprintPlanId_order_idx" ON "sprints"("sprintPlanId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_sprintPlanId_number_key" ON "sprints"("sprintPlanId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_dependencies_sprintId_dependsOnSprintId_key" ON "sprint_dependencies"("sprintId", "dependsOnSprintId");

-- CreateIndex
CREATE INDEX "tasks_sprintId_order_idx" ON "tasks"("sprintId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_sprintPlanId_key_key" ON "tasks"("sprintPlanId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");

-- AddForeignKey
ALTER TABLE "sprint_plans" ADD CONSTRAINT "sprint_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_plans" ADD CONSTRAINT "sprint_plans_architectureId_fkey" FOREIGN KEY ("architectureId") REFERENCES "architectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_sprintPlanId_fkey" FOREIGN KEY ("sprintPlanId") REFERENCES "sprint_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_dependencies" ADD CONSTRAINT "sprint_dependencies_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_dependencies" ADD CONSTRAINT "sprint_dependencies_dependsOnSprintId_fkey" FOREIGN KEY ("dependsOnSprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprintPlanId_fkey" FOREIGN KEY ("sprintPlanId") REFERENCES "sprint_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
