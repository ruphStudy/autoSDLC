export type WorkspaceStatus =
  | 'NOT_PREPARED'
  | 'PREPARING'
  | 'READY'
  | 'INVALID'
  | 'FAILED'
  | 'CLEANING';

// Mirrors the backend's WorkspaceRecord — deliberately excludes the
// absolute filesystem path (never sent to the client).
export interface Workspace {
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
  preparedAt: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChangedFileStatus = 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'UNTRACKED';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  staged: boolean;
  fromPath?: string;
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

export interface RepositoryReadiness {
  ready: boolean;
  gitRepository: boolean;
  clean: boolean;
  branch: string | null;
  developmentBranch: string | null;
  headCommitSha: string | null;
  remoteConfigured: boolean;
  issues: string[];
}

// A workspace the UI should keep polling for — not yet in a settled state.
export const ACTIVE_WORKSPACE_STATUSES: WorkspaceStatus[] = ['PREPARING', 'CLEANING'];
