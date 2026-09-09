import * as path from 'node:path';
import {
  EXCLUDED_CONTENT_PATTERNS,
  SENSITIVE_FILE_PATTERNS,
} from '../task-instruction.constants';

// Defense in depth alongside the filesystem walk's own root confinement:
// resolves a repository-relative path against the workspace root and
// rejects anything that escapes it. A local, dependency-free copy of the
// same containment check used elsewhere (WorkspacePathService,
// coding-agent's command-policy) — kept local so this module doesn't take
// on a cross-module dependency for a ~10-line pure function.
export function isPathWithinWorkspace(
  candidatePath: string,
  workspacePath: string,
): boolean {
  const resolvedRoot = path.resolve(workspacePath);
  const resolvedCandidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(resolvedRoot, candidatePath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Never automatically read a file matching one of these, no matter how
// small or manifest-like it looks (item 61).
export function isSensitivePath(relativePath: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

// Lockfiles / minified / sourcemap artifacts — package-manager identity
// matters, full content does not (item 63/64).
export function isExcludedContentPath(relativePath: string): boolean {
  return EXCLUDED_CONTENT_PATTERNS.some((pattern) =>
    pattern.test(relativePath),
  );
}

// Cheap, dependency-free binary sniff: a NUL byte in the first chunk is a
// reliable enough signal for excluding binaries from planning context —
// this doesn't need MIME-accuracy, just "don't send garbage bytes to the
// planning model" (item 62).
export function looksBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleLength; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
