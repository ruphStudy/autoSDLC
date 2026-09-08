import * as path from 'node:path';
import { GitError, GitErrorCode } from './errors/git.error';

// A UUID (Prisma's default @id) is the only thing ever used to derive a
// workspace directory name — never the Project name, which may contain
// spaces, slashes, unicode, or shell-meaningful characters.
export const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Plain, dependency-free functions (no NestJS DI) so they can be shared by
// WorkspacePathService (the injectable used throughout the workspace
// feature) and by ProjectsService's best-effort cleanup-on-delete, without
// either module needing to import the other's NestJS module and risking a
// circular module dependency.

export function assertWithinRoot(candidate: string, root: string): void {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolvedCandidate);

  if (rel === '') {
    throw new GitError({
      code: GitErrorCode.PATH_VIOLATION,
      message: 'Refusing to operate on the workspace root itself.',
    });
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new GitError({
      code: GitErrorCode.PATH_VIOLATION,
      message: 'Resolved path escapes the configured workspace root.',
    });
  }
}

export function resolveProjectWorkspacePath(
  root: string,
  projectId: string,
): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new GitError({
      code: GitErrorCode.PATH_VIOLATION,
      message: 'Invalid project identifier.',
    });
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, projectId);
  assertWithinRoot(candidate, resolvedRoot);
  return candidate;
}
