-- CreateEnum
CREATE TYPE "RepositoryType" AS ENUM ('NEW', 'EXISTING');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ANALYZING', 'ANALYSIS_READY', 'PLANNING', 'PLAN_READY', 'AWAITING_APPROVAL', 'DEVELOPING', 'TESTING', 'COMPLETED', 'FAILED', 'PAUSED');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brief" TEXT NOT NULL,
    "preferredStack" TEXT,
    "repositoryType" "RepositoryType" NOT NULL DEFAULT 'NEW',
    "repositoryUrl" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_userId_archivedAt_idx" ON "projects"("userId", "archivedAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
