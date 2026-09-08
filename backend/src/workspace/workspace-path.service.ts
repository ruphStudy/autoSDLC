import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { WorkspaceConfigService } from './workspace.config';
import { GitError, GitErrorCode } from './errors/git.error';
import {
  assertWithinRoot as assertWithinRootUtil,
  resolveProjectWorkspacePath as resolveProjectWorkspacePathUtil,
} from './workspace-path.util';

// The one place that turns a projectId into a filesystem path, and the one
// place that decides whether a path is safe to touch. Every operation that
// eventually reaches the filesystem (create, stage, cleanup) must go
// through this — never build a path ad hoc elsewhere. The underlying
// checks live in workspace-path.util (plain functions, no DI) so
// ProjectsService's best-effort cleanup-on-delete can reuse the exact same
// safety logic without depending on WorkspaceModule.
@Injectable()
export class WorkspacePathService {
  constructor(private readonly config: WorkspaceConfigService) {}

  private get resolvedRoot(): string {
    return path.resolve(this.config.workspaceRoot);
  }

  // Resolves and validates the isolated directory for a Project. Does not
  // require the directory to exist yet (safe to call before `mkdir`).
  resolveProjectWorkspacePath(projectId: string): string {
    return resolveProjectWorkspacePathUtil(this.resolvedRoot, projectId);
  }

  // Guards every destructive/traversal-sensitive operation: the resolved
  // path must be a real descendant of the workspace root, and must never
  // be the root itself (so a caller can never be tricked into deleting
  // WORKSPACE_ROOT).
  assertWithinRoot(candidate: string, root: string = this.resolvedRoot): void {
    assertWithinRootUtil(candidate, root);
  }

  // Same containment check, but resolved through the real filesystem path
  // (following symlinks) — used immediately before a destructive operation
  // so a symlink swapped in after path resolution can't redirect it outside
  // the workspace root.
  async assertRealPathWithinRoot(candidate: string): Promise<void> {
    const root = this.resolvedRoot;
    let realRoot: string;
    let realCandidate: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      // Root doesn't exist yet — nothing has been created, so there is
      // nothing a symlink could have redirected. Fall back to the plain
      // (non-symlink-resolved) check.
      this.assertWithinRoot(candidate, root);
      return;
    }
    try {
      realCandidate = await fs.realpath(candidate);
    } catch {
      // Candidate doesn't exist — safe by construction, nothing to delete.
      this.assertWithinRoot(candidate, root);
      return;
    }
    this.assertWithinRoot(realCandidate, realRoot);
  }

  // Validates a repository-relative path supplied for staging — never
  // absolute, never escaping via `..`.
  assertSafeRelativePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new GitError({
        code: GitErrorCode.PATH_VIOLATION,
        message: 'File paths must be relative to the repository root.',
      });
    }
    const normalized = path.normalize(relativePath);
    const segments = normalized.split(path.sep);
    if (segments.includes('..') || normalized.startsWith('..')) {
      throw new GitError({
        code: GitErrorCode.PATH_VIOLATION,
        message: 'File paths must not escape the repository root.',
      });
    }
    return normalized;
  }

  async ensureDirectory(target: string): Promise<void> {
    this.assertWithinRoot(target);
    await fs.mkdir(target, { recursive: true });
  }

  async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  // The one place allowed to recursively delete a workspace directory.
  // Every safeguard applies before the delete, not after.
  async removeWorkspaceDirectory(target: string): Promise<void> {
    this.assertWithinRoot(target);
    await this.assertRealPathWithinRoot(target);
    if (!(await this.exists(target))) {
      return;
    }
    await fs.rm(target, { recursive: true, force: true });
  }
}
