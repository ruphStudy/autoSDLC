-- CreateEnum
CREATE TYPE "AnalysisSource" AS ENUM ('AI_GENERATED', 'USER_EDITED');

-- CreateTable
CREATE TABLE "project_analyses" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "AnalysisSource" NOT NULL,
    "basedOnVersion" INTEGER,
    "summary" TEXT NOT NULL,
    "targetUsers" JSONB NOT NULL,
    "goals" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "functionalRequirements" JSONB NOT NULL,
    "nonFunctionalRequirements" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "unresolvedQuestions" JSONB NOT NULL,
    "integrations" JSONB NOT NULL,
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

    CONSTRAINT "project_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_analyses_projectId_createdAt_idx" ON "project_analyses"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_analyses_projectId_version_key" ON "project_analyses"("projectId", "version");

-- AddForeignKey
ALTER TABLE "project_analyses" ADD CONSTRAINT "project_analyses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
