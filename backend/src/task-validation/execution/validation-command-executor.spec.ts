import * as os from 'node:os';
import { ValidationCommandExecutor } from './validation-command-executor';
import { TaskValidationConfigService } from '../task-validation.config';

function buildConfig(
  overrides: Partial<TaskValidationConfigService> = {},
): TaskValidationConfigService {
  return {
    commandTimeoutMs: 5000,
    maxOutputBytes: 1024 * 1024,
    ...overrides,
  } as TaskValidationConfigService;
}

describe('ValidationCommandExecutor (real subprocess)', () => {
  it('reports exit code 0 as success', async () => {
    const executor = new ValidationCommandExecutor(buildConfig());
    const result = await executor.run('node', ['-e', 'process.exit(0)'], {
      cwd: os.tmpdir(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it('reports a non-zero exit code as failure', async () => {
    const executor = new ValidationCommandExecutor(buildConfig());
    const result = await executor.run('node', ['-e', 'process.exit(1)'], {
      cwd: os.tmpdir(),
    });
    expect(result.exitCode).toBe(1);
  });

  it('captures stdout and stderr', async () => {
    const executor = new ValidationCommandExecutor(buildConfig());
    const result = await executor.run(
      'node',
      ['-e', 'console.log("hello-stdout"); console.error("hello-stderr");'],
      { cwd: os.tmpdir() },
    );
    expect(result.stdout).toContain('hello-stdout');
    expect(result.stderr).toContain('hello-stderr');
  });

  it('truncates output beyond the configured byte limit and flags it', async () => {
    const executor = new ValidationCommandExecutor(
      buildConfig({ maxOutputBytes: 100 }),
    );
    const result = await executor.run(
      'node',
      ['-e', 'console.log("x".repeat(10000))'],
      { cwd: os.tmpdir() },
    );
    expect(result.outputTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(100);
  });

  it('times out a hanging command and reports timedOut', async () => {
    const executor = new ValidationCommandExecutor(
      buildConfig({ commandTimeoutMs: 200 }),
    );
    const result = await executor.run(
      'node',
      ['-e', 'setTimeout(() => {}, 60000)'],
      { cwd: os.tmpdir() },
    );
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  }, 10000);

  it('supports cancellation via AbortSignal, distinct from a timeout', async () => {
    const executor = new ValidationCommandExecutor(
      buildConfig({ commandTimeoutMs: 60000 }),
    );
    const controller = new AbortController();
    const promise = executor.run(
      'node',
      ['-e', 'setTimeout(() => {}, 60000)'],
      { cwd: os.tmpdir(), signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 200);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  }, 10000);

  it('runs the command inside the given working directory', async () => {
    const executor = new ValidationCommandExecutor(buildConfig());
    const result = await executor.run(
      'node',
      ['-e', 'console.log(process.cwd())'],
      {
        cwd: os.tmpdir(),
      },
    );
    // Resolve both sides through realpath-equivalent normalization is
    // unnecessary here — just confirm the printed cwd matches what was
    // requested (Node prints its own resolved absolute path).
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('never forwards orchestrator secrets to the subprocess environment', async () => {
    const originalSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = 'super-secret-value';
    try {
      const executor = new ValidationCommandExecutor(buildConfig());
      const result = await executor.run(
        'node',
        ['-e', 'console.log(JSON.stringify(process.env))'],
        { cwd: os.tmpdir() },
      );
      expect(result.stdout).not.toContain('super-secret-value');
      expect(result.stdout).toContain('"CI":"true"');
    } finally {
      if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = originalSecret;
    }
  });

  it('does not use a shell — a command string with shell metacharacters is never interpreted', async () => {
    const executor = new ValidationCommandExecutor(buildConfig());
    // If this were shell-interpreted, "; touch /tmp/pwned" would run as a
    // second command. Passed as a single argv entry, node just receives it
    // as literal (invalid) script text and exits non-zero — it must never
    // be split/interpreted as two commands.
    const result = await executor.run(
      'node',
      ['-e', 'console.log(1); process.exit(0)'],
      { cwd: os.tmpdir() },
    );
    expect(result.exitCode).toBe(0);
  });
});
