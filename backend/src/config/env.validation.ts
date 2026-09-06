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
});
