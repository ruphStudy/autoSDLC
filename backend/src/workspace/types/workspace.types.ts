import { WorkspaceStatus } from '@prisma/client';
import { ChangedFile } from '../git/git.types';

// Public-facing shape — deliberately excludes the absolute filesystem path
// (see item 27/53/66: never expose the server's workspace path to clients).
export interface WorkspaceRecord {
  id: string;
  projectId: string;
  status: WorkspaceStatus;
  defaultBranch: string | null;
  developmentBranch: string | null;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  headCommitSha: string | null;
  clean: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
  preparedAt: Date | null;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceStatusResult {
  clean: boolean;
  files: ChangedFile[];
}

export interface WorkspaceDiffResult {
  diff: string;
  truncated: boolean;
  sizeBytes: number;
}
