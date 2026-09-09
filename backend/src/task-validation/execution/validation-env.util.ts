// Builds the environment for a validation subprocess (lint/typecheck/test/
// build commands run against a generated project's own repository).
// Deliberately does NOT spread `process.env` — the orchestrator backend's
// own secrets (JWT secrets, OPENAI_API_KEY, CLAUDE_API_KEY, DATABASE_URL,
// etc.) must never reach a subprocess running arbitrary-repository test/
// build scripts. Mirrors coding-agent/providers/claude-env.util.ts exactly.
const INHERITED_RUNTIME_VARS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  // Needed for npm/pnpm/yarn/bun to resolve global installs/caches
  // correctly when running the repository's own scripts.
  'npm_config_cache',
  'NODE_PATH',
] as const;

export function buildSanitizedValidationEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of INHERITED_RUNTIME_VARS) {
    const value = processEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Standard, widely-respected signal to disable interactive/watch modes
  // (Jest, most test runners) — never changes what a check verifies, only
  // whether it exits instead of waiting forever (item 60).
  env.CI = 'true';

  return env;
}
