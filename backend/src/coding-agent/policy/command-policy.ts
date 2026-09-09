import * as path from 'node:path';

// The safe, narrow coding subset (item 33/34) — passed as `tools` so the SDK
// disables every other built-in tool (web fetch/search, subagents, MCP
// management, artifacts, notifications, etc.) at the technical level rather
// than relying on the model simply choosing not to use them.
export const ALLOWED_CODING_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
] as const;

interface DeniedCommandRule {
  pattern: RegExp;
  reason: string;
}

interface DeniedCommandPredicate {
  test: (command: string) => boolean;
  reason: string;
}

// Deliberately not exhaustive (item 28: "do not attempt to enumerate every
// dangerous command perfectly") — this is a coarse denylist layered on top
// of the stronger structural controls (restricted tool set, cwd
// containment, no auto-commit/push guardrail). Git write/push/history
// rewrite is denied here even though `disallowedTools` can't distinguish
// git subcommands from any other Bash invocation.
const DENIED_COMMAND_RULES: DeniedCommandRule[] = [
  { pattern: /\bsudo\b/i, reason: 'sudo is not permitted.' },
  {
    pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+\/(\s|$)/i,
    reason: 'Recursive force-delete of the filesystem root is not permitted.',
  },
  {
    pattern:
      /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+~(\s|\/|$)/i,
    reason: 'Recursive force-delete of the home directory is not permitted.',
  },
  {
    pattern: /\b(shutdown|reboot|halt)\b/i,
    reason: 'System power commands are not permitted.',
  },
  {
    pattern: /\bmkfs(\.\w+)?\b/i,
    reason: 'Filesystem formatting commands are not permitted.',
  },
  {
    pattern: /\bdd\b[^\n]*\bof=\/dev\//i,
    reason: 'Writing directly to a raw device is not permitted.',
  },
  {
    pattern: /\bdiskutil\s+(erase|partition|reformat)/i,
    reason: 'Destructive diskutil operations are not permitted.',
  },
  {
    pattern:
      /\b(apt(-get)?|yum|dnf|brew)\s+(remove|purge|uninstall)\b.*(-y\b.*(--force|--purge)|--force)/i,
    reason: 'Forced system-wide package removal is not permitted.',
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i,
    reason: 'Fork bombs are not permitted.',
  },
  {
    pattern: /\bchmod\s+(-R\s+)?0*777\s+\/(\s|$)/i,
    reason:
      'Recursively opening permissions on the filesystem root is not permitted.',
  },
  {
    pattern: /\bcurl\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    reason: 'Piping a remote download directly into a shell is not permitted.',
  },
  {
    pattern: /\bwget\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    reason: 'Piping a remote download directly into a shell is not permitted.',
  },

  // Git: read/inspect is fine; the orchestrator owns write/publish/history
  // boundaries (item 29/30).
  {
    pattern: /\bgit\s+push\b/i,
    reason:
      'Claude must not push. The orchestrator controls when and what gets pushed.',
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: 'Destructive Git history operations are not permitted.',
  },
  {
    pattern: /\bgit\s+(checkout|restore)\s+\.\s*$/i,
    reason: 'Discarding uncommitted changes is not permitted.',
  },
  {
    pattern: /\bgit\s+rebase\b/i,
    reason: 'Git history rewriting is not permitted.',
  },
  {
    pattern: /\bgit\s+commit\b/i,
    reason:
      'Claude must not commit. The orchestrator commits after validation.',
  },
  {
    pattern: /\bgit\s+branch\s+(-[a-z]*D[a-z]*|--delete\s+--force)/i,
    reason: 'Force-deleting branches is not permitted.',
  },
];

// `git clean`'s -f/-d flags may be combined (-fd) or passed separately
// (-f -d, -d -f) — a single regex can't cleanly express "both flags appear
// somewhere after `git clean`", so this is a predicate instead.
const DENIED_COMMAND_PREDICATES: DeniedCommandPredicate[] = [
  {
    test: (command) => {
      const match = /\bgit\s+clean\b(.*)$/i.exec(command);
      if (!match) return false;
      const rest = match[1];
      const hasForce =
        /(^|\s)-[a-z]*f[a-z]*(\s|$)/i.test(rest) || /--force\b/i.test(rest);
      const hasDirs = /(^|\s)-[a-z]*d[a-z]*(\s|$)/i.test(rest);
      return hasForce && hasDirs;
    },
    reason: 'Destructive Git clean operations are not permitted.',
  },
];

export interface CommandPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateBashCommand(command: string): CommandPolicyDecision {
  for (const rule of DENIED_COMMAND_RULES) {
    if (rule.pattern.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }
  for (const rule of DENIED_COMMAND_PREDICATES) {
    if (rule.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }
  return { allowed: true };
}

// Defense in depth alongside the SDK's own cwd-based containment: resolves
// a tool-reported path (which may be relative or absolute) against the
// workspace root and rejects anything that escapes it. Mirrors
// WorkspacePathService's containment check, kept local (no cross-module
// dependency needed) since this only ever runs against a path string, not
// the filesystem.
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
