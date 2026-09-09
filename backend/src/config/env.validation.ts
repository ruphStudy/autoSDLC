import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3001),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Only 'openai' is supported today; listing it explicitly means an
  // unsupported value fails app startup instead of silently falling back.
  PLANNING_AI_PROVIDER: Joi.string().valid('openai').default('openai'),
  OPENAI_API_KEY: Joi.string().when('PLANNING_AI_PROVIDER', {
    is: 'openai',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OPENAI_PLANNING_MODEL: Joi.string().default('gpt-4o-mini'),
  OPENAI_PLANNING_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(90000),
  OPENAI_PLANNING_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  OPENAI_PLANNING_TEMPERATURE: Joi.number().min(0).max(2).default(0.2),

  // Background job worker (Sprint 8). Always disabled under NODE_ENV=test
  // regardless of this flag — see JobWorkerService.
  JOB_WORKER_ENABLED: Joi.boolean().default(true),
  JOB_POLL_INTERVAL_MS: Joi.number().integer().min(100).default(2000),
  JOB_BATCH_SIZE: Joi.number().integer().min(1).max(50).default(5),
  JOB_LOCK_TIMEOUT_SECONDS: Joi.number().integer().min(10).default(300),
  JOB_HEARTBEAT_SECONDS: Joi.number().integer().min(5).default(60),
  JOB_DEFAULT_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(3),
  JOB_RETRY_BASE_DELAY_SECONDS: Joi.number().integer().min(1).default(5),
  JOB_RETRY_MAX_DELAY_SECONDS: Joi.number().integer().min(1).default(300),
  JOB_MAX_PAYLOAD_BYTES: Joi.number().integer().min(1024).default(65536),
  JOB_MAX_RESULT_BYTES: Joi.number().integer().min(1024).default(65536),

  // Git/workspace infrastructure (Sprint 9). Defaults to a system temp
  // directory, deliberately outside this repository — never let a
  // customer's cloned/initialized workspace land inside the orchestrator's
  // own working tree (see WorkspaceConfigService).
  WORKSPACE_ROOT: Joi.string().default('/tmp/autosdlc-workspaces'),
  WORKSPACE_MAX_SIZE_MB: Joi.number().integer().min(1).default(2048),
  GIT_COMMAND_TIMEOUT_MS: Joi.number().integer().min(1000).default(60000),
  GIT_CLONE_TIMEOUT_MS: Joi.number().integer().min(1000).default(180000),
  GIT_DEFAULT_BRANCH: Joi.string().default('main'),
  GIT_MAX_OUTPUT_BYTES: Joi.number().integer().min(1024).default(1048576),
  GIT_AUTHOR_NAME: Joi.string().default('Autonomous Dev Orchestrator'),
  GIT_AUTHOR_EMAIL: Joi.string().default('autodev@localhost'),

  // Coding agent provider (Sprint 10). Only 'claude' is supported today —
  // listed explicitly so an unsupported value fails app startup instead of
  // silently falling back (same reasoning as PLANNING_AI_PROVIDER above).
  // Authentication is validated in CodingAgentConfigService, not here: the
  // Claude Agent SDK accepts EITHER CLAUDE_API_KEY (mapped to
  // ANTHROPIC_API_KEY) OR CLAUDE_CODE_OAUTH_TOKEN (the officially supported
  // non-interactive token for CI/automation use, distinct from an
  // interactive `claude login` session) — "at least one of two" isn't a
  // clean Joi .when(), so both stay optional here.
  CODING_AGENT_PROVIDER: Joi.string().valid('claude').default('claude'),
  CLAUDE_API_KEY: Joi.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: Joi.string().optional(),
  CLAUDE_MODEL: Joi.string().default('claude-sonnet-5'),
  CLAUDE_MAX_TURNS: Joi.number().integer().min(1).max(200).default(25),
  CLAUDE_EXECUTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(3600000)
    .default(900000),
  CLAUDE_MAX_OUTPUT_BYTES: Joi.number().integer().min(1024).default(1048576),

  // Task instruction generation (Sprint 11) — bounds on how much repository
  // context is ever assembled for a single instruction-generation call. See
  // RepositoryTreeService / TaskContextBuilder.
  TASK_CONTEXT_MAX_TREE_ENTRIES: Joi.number().integer().min(1).default(1000),
  TASK_CONTEXT_MAX_FILES: Joi.number().integer().min(1).default(20),
  TASK_CONTEXT_MAX_FILE_BYTES: Joi.number().integer().min(1).default(50000),
  TASK_CONTEXT_MAX_TOTAL_BYTES: Joi.number().integer().min(1).default(300000),
  TASK_CONTEXT_RECENT_COMMITS: Joi.number().integer().min(0).default(10),
  TASK_INSTRUCTION_MAX_CHARS: Joi.number().integer().min(1000).default(50000),

  // Single Task Orchestrator (Sprint 12) — bounds how much of a Git diff is
  // persisted per execution attempt. See TaskExecutionConfigService.
  TASK_EXECUTION_MAX_DIFF_CHARS: Joi.number()
    .integer()
    .min(1000)
    .default(200000),
});
