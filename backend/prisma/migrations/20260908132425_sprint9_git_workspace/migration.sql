-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('NOT_PREPARED', 'PREPARING', 'READY', 'INVALID', 'FAILED', 'CLEANING');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'WORKSPACE_PREPARE';

-- CreateTable
CREATE TABLE "project_workspaces" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'NOT_PREPARED',
    "workspacePath" TEXT,
    "defaultBranch" TEXT,
    "developmentBranch" TEXT,
    "currentBranch" TEXT,
    "remoteName" TEXT,
    "remoteUrl" TEXT,
    "headCommitSha" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "preparedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_workspaces_projectId_key" ON "project_workspaces"("projectId");

-- AddForeignKey
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
