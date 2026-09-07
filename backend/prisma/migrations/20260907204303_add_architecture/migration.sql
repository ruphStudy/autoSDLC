-- CreateTable
CREATE TABLE "architectures" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectAnalysisId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "AnalysisSource" NOT NULL,
    "basedOnVersion" INTEGER,
    "summary" TEXT NOT NULL,
    "frontendArchitecture" JSONB NOT NULL,
    "backendArchitecture" JSONB NOT NULL,
    "apiArchitecture" JSONB NOT NULL,
    "databaseArchitecture" JSONB NOT NULL,
    "authenticationArchitecture" JSONB NOT NULL,
    "integrationArchitecture" JSONB NOT NULL,
    "infrastructureArchitecture" JSONB NOT NULL,
    "deploymentArchitecture" JSONB NOT NULL,
    "securityArchitecture" JSONB NOT NULL,
    "testingStrategy" JSONB NOT NULL,
    "nonFunctionalDecisions" JSONB NOT NULL,
    "architectureDecisions" JSONB NOT NULL,
    "requirementTraceability" JSONB NOT NULL,
    "unresolvedQuestions" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
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

    CONSTRAINT "architectures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "architectures_projectId_createdAt_idx" ON "architectures"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "architectures_projectAnalysisId_idx" ON "architectures"("projectAnalysisId");

-- CreateIndex
CREATE UNIQUE INDEX "architectures_projectId_version_key" ON "architectures"("projectId", "version");

-- AddForeignKey
ALTER TABLE "architectures" ADD CONSTRAINT "architectures_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "architectures" ADD CONSTRAINT "architectures_projectAnalysisId_fkey" FOREIGN KEY ("projectAnalysisId") REFERENCES "project_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
