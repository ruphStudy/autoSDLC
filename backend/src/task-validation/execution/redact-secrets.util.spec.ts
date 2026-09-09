import { redactSecrets } from './redact-secrets.util';

describe('redactSecrets', () => {
  it('redacts an Authorization header line', () => {
    const out = redactSecrets('Authorization: Bearer abc.def.ghi');
    expect(out).not.toContain('abc.def.ghi');
  });

  it('redacts a bare Bearer token', () => {
    const out = redactSecrets('sent header Bearer xyz123.token-value');
    expect(out).not.toContain('xyz123.token-value');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('redacts credentials embedded in a URL', () => {
    const out = redactSecrets(
      'cloning https://user:hunter2@github.com/org/repo.git',
    );
    expect(out).not.toContain('hunter2');
    expect(out).toContain('https://[REDACTED]@github.com');
  });

  it('redacts an OpenAI-style API key', () => {
    const out = redactSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('redacts an Anthropic-style API key', () => {
    const out = redactSecrets('key: sk-ant-abcdefghijklmnopqrstuvwx');
    expect(out).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
  });

  it('redacts a GitHub personal access token', () => {
    const out = redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz1234');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234');
  });

  it('leaves ordinary test output untouched', () => {
    const text =
      'PASS src/foo.spec.ts\n  ✓ does the thing (12 ms)\n\nTests: 1 passed';
    expect(redactSecrets(text)).toBe(text);
  });
});
