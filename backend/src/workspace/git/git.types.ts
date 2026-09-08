export interface GitCommandResult {
  command: 'git';
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export type ChangedFileStatus =
  'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'UNTRACKED';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  staged: boolean;
  // Only set for renames — the path before the rename.
  fromPath?: string;
}

export interface GitStatusResult {
  clean: boolean;
  files: ChangedFile[];
}

export interface GitDiffResult {
  diff: string;
  truncated: boolean;
  sizeBytes: number;
}

export interface RemoteInfo {
  name: string;
  url: string;
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
