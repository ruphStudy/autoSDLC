import { buildSanitizedClaudeEnv } from './claude-env.util';

describe('buildSanitizedClaudeEnv', () => {
  const backendProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/service',
    LANG: 'en_US.UTF-8',
    // Platform secrets that must never reach the coding-agent process.
    JWT_ACCESS_SECRET: 'super-secret-access',
    JWT_REFRESH_SECRET: 'super-secret-refresh',
    OPENAI_API_KEY: 'sk-openai-secret',
    DATABASE_URL: 'postgresql://user:dbpassword@localhost:5432/autosdlc',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    REDIS_URL: 'redis://:redispass@localhost:6379',
  };

  it('never forwards the full process.env — only an explicit allowlist', () => {
    const env = buildSanitizedClaudeEnv(
      { apiKey: 'claude-key' },
      backendProcessEnv,
    );

    expect(env).not.toHaveProperty('JWT_ACCESS_SECRET');
    expect(env).not.toHaveProperty('JWT_REFRESH_SECRET');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('REDIS_URL');

    expect(JSON.stringify(env)).not.toContain('super-secret');
    expect(JSON.stringify(env)).not.toContain('dbpassword');
    expect(JSON.stringify(env)).not.toContain('redispass');
    expect(JSON.stringify(env)).not.toContain('aws-secret');
    expect(JSON.stringify(env)).not.toContain('sk-openai-secret');
  });

  it('carries through only the intended runtime variables', () => {
    const env = buildSanitizedClaudeEnv(
      { apiKey: 'claude-key' },
      backendProcessEnv,
    );
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/service');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('maps CLAUDE_API_KEY to ANTHROPIC_API_KEY for the SDK', () => {
    const env = buildSanitizedClaudeEnv(
      { apiKey: 'claude-key-value' },
      backendProcessEnv,
    );
    expect(env.ANTHROPIC_API_KEY).toBe('claude-key-value');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('passes through an OAuth token instead when configured', () => {
    const env = buildSanitizedClaudeEnv(
      { oauthToken: 'oauth-token-value' },
      backendProcessEnv,
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token-value');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('sets neither credential when unconfigured (health-check-only path)', () => {
    const env = buildSanitizedClaudeEnv({}, backendProcessEnv);
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('omits an inherited variable entirely when absent from process.env', () => {
    const env = buildSanitizedClaudeEnv({ apiKey: 'x' }, { PATH: '/usr/bin' });
    expect(env).not.toHaveProperty('HOME');
    expect(env).not.toHaveProperty('LANG');
  });
});
