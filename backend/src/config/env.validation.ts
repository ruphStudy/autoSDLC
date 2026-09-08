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
});
