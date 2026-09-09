import { ValidationCheckType } from '@prisma/client';
import { ValidationPlanResolver } from './validation-plan-resolver';
import { DetectedPackage } from './tooling.types';

function buildPackage(
  overrides: Partial<DetectedPackage> = {},
): DetectedPackage {
  return {
    name: 'backend',
    dir: 'backend',
    packageManager: 'npm',
    scripts: {},
    hasTsconfig: false,
    hasTypescriptDependency: false,
    ...overrides,
  };
}

describe('ValidationPlanResolver', () => {
  let toolingDetector: { detect: jest.Mock };
  let resolver: ValidationPlanResolver;

  beforeEach(() => {
    toolingDetector = { detect: jest.fn() };
    resolver = new ValidationPlanResolver(toolingDetector as never);
  });

  it('resolves a lint script found on a package', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [buildPackage({ scripts: { lint: 'eslint .' } })],
    });

    const checks = await resolver.resolve(
      [{ type: 'lint', description: 'Lint the code', required: true }],
      '/workspace',
    );

    expect(checks).toEqual([
      {
        type: ValidationCheckType.LINT,
        name: 'Backend lint',
        command: 'npm',
        args: ['run', 'lint'],
        workingDirectory: 'backend',
        required: true,
      },
    ]);
  });

  it('resolves unit_test to an alias script (test:unit before test)', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [
        buildPackage({ scripts: { 'test:unit': 'jest', test: 'jest --all' } }),
      ],
    });

    const checks = await resolver.resolve(
      [{ type: 'unit_test', description: 'Run unit tests', required: true }],
      '/workspace',
    );

    expect(checks[0].args).toEqual(['run', 'test:unit']);
  });

  it('falls back to "test" when "test:unit" is not present', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [buildPackage({ scripts: { test: 'jest' } })],
    });

    const checks = await resolver.resolve(
      [{ type: 'unit_test', description: 'Run unit tests', required: true }],
      '/workspace',
    );

    expect(checks[0].args).toEqual(['run', 'test']);
  });

  it('produces one ValidationCheck per package that has the script', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [
        buildPackage({
          name: 'backend',
          dir: 'backend',
          scripts: { build: 'nest build' },
        }),
        buildPackage({
          name: 'frontend',
          dir: 'frontend',
          scripts: { build: 'vite build' },
        }),
      ],
    });

    const checks = await resolver.resolve(
      [{ type: 'build', description: 'Build everything', required: true }],
      '/workspace',
    );

    expect(checks).toHaveLength(2);
    expect(checks.map((c) => c.workingDirectory).sort()).toEqual([
      'backend',
      'frontend',
    ]);
  });

  it('falls back to `tsc --noEmit` for typecheck when tsconfig + typescript dependency are present but no script exists', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [
        buildPackage({ hasTsconfig: true, hasTypescriptDependency: true }),
      ],
    });

    const checks = await resolver.resolve(
      [{ type: 'typecheck', description: 'Typecheck', required: true }],
      '/workspace',
    );

    expect(checks[0].command).toBe('npx');
    expect(checks[0].args).toEqual(['--no-install', 'tsc', '--noEmit']);
  });

  it('never invents a typecheck fallback without both tsconfig.json and a typescript dependency', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [
        buildPackage({ hasTsconfig: true, hasTypescriptDependency: false }),
      ],
    });

    const checks = await resolver.resolve(
      [{ type: 'typecheck', description: 'Typecheck', required: true }],
      '/workspace',
    );

    expect(checks[0].unavailableReason).toBeDefined();
    expect(checks[0].command).toBe('');
  });

  it('marks a required check with no matching script as unavailable (never invents a command)', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [buildPackage({ scripts: {} })],
    });

    const checks = await resolver.resolve(
      [{ type: 'lint', description: 'Lint', required: true }],
      '/workspace',
    );

    expect(checks).toEqual([
      expect.objectContaining({
        type: ValidationCheckType.LINT,
        command: '',
        args: [],
        required: true,
        unavailableReason: expect.any(String),
      }),
    ]);
  });

  it('marks "manual" expectations as unavailable and preserves required/optional', async () => {
    toolingDetector.detect.mockResolvedValue({ packages: [buildPackage()] });

    const checks = await resolver.resolve(
      [
        {
          type: 'manual',
          description: 'Have a human check the UI',
          required: false,
        },
      ],
      '/workspace',
    );

    expect(checks[0].unavailableReason).toMatch(/manual/i);
    expect(checks[0].required).toBe(false);
  });

  it('marks "other" expectations as unavailable rather than guessing a command', async () => {
    toolingDetector.detect.mockResolvedValue({ packages: [buildPackage()] });

    const checks = await resolver.resolve(
      [{ type: 'other', description: 'Something bespoke', required: true }],
      '/workspace',
    );

    expect(checks[0].unavailableReason).toBeDefined();
    expect(checks[0].command).toBe('');
  });

  it('uses pnpm-flavored commands for a pnpm package', async () => {
    toolingDetector.detect.mockResolvedValue({
      packages: [
        buildPackage({ packageManager: 'pnpm', scripts: { build: 'tsc' } }),
      ],
    });

    const checks = await resolver.resolve(
      [{ type: 'build', description: 'Build', required: true }],
      '/workspace',
    );

    expect(checks[0].command).toBe('pnpm');
    expect(checks[0].args).toEqual(['run', 'build']);
  });
});
