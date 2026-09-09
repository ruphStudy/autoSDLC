// Builds the environment for the Claude Agent SDK's spawned subprocess.
// Critically, this does NOT spread `process.env`: the SDK's `env` option
// REPLACES the child environment entirely (see @anthropic-ai/claude-agent-sdk
// Options.env), so whatever we build here is exactly what the coding-agent
// process — and anything it spawns via Bash — can see. The orchestrator
// backend's own secrets (DB password, JWT secrets, OPENAI_API_KEY, etc.)
// are never forwarded.
export interface ClaudeAuthConfig {
  apiKey?: string;
  oauthToken?: string;
}

const INHERITED_RUNTIME_VARS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  // Needed for npm/pnpm/yarn invoked by the agent's own Bash tool calls
  // (item 37) to resolve global installs/caches correctly.
  'npm_config_cache',
  'NODE_PATH',
] as const;

export function buildSanitizedClaudeEnv(
  auth: ClaudeAuthConfig,
  processEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of INHERITED_RUNTIME_VARS) {
    const value = processEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
  }
  if (auth.oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = auth.oauthToken;
  }

  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'autosdlc-coding-agent/1.0';

  return env;
}
