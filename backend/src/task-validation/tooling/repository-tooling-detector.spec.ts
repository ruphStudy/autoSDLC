import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepositoryToolingDetector } from './repository-tooling-detector';

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function writeFile(filePath: string, content = ''): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe('RepositoryToolingDetector (real filesystem fixtures)', () => {
  let tmpDir: string;
  let detector: RepositoryToolingDetector;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-tooling-detector-'),
    );
    detector = new RepositoryToolingDetector();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects npm via package-lock.json when no packageManager field is set', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      scripts: { build: 'tsc' },
    });
    await writeFile(path.join(tmpDir, 'package-lock.json'));

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages).toHaveLength(1);
    expect(tooling.packages[0].packageManager).toBe('npm');
    expect(tooling.packages[0].name).toBe('root');
  });

  it('detects pnpm via pnpm-lock.yaml', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), { scripts: {} });
    await writeFile(path.join(tmpDir, 'pnpm-lock.yaml'));

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages[0].packageManager).toBe('pnpm');
  });

  it('detects yarn via yarn.lock', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), { scripts: {} });
    await writeFile(path.join(tmpDir, 'yarn.lock'));

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages[0].packageManager).toBe('yarn');
  });

  it('prefers an explicit valid packageManager field over lockfile detection', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      packageManager: 'pnpm@9.0.0',
      scripts: {},
    });
    await writeFile(path.join(tmpDir, 'package-lock.json'));

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages[0].packageManager).toBe('pnpm');
  });

  it('ignores an invalid packageManager field and falls back to lockfile detection', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      packageManager: 'not-a-real-manager@1.0.0',
      scripts: {},
    });
    await writeFile(path.join(tmpDir, 'yarn.lock'));

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages[0].packageManager).toBe('yarn');
  });

  it('detects the conventional backend/frontend monorepo structure used by this platform', async () => {
    await writeJson(path.join(tmpDir, 'backend', 'package.json'), {
      scripts: { lint: 'eslint .', build: 'nest build', test: 'jest' },
    });
    await writeFile(path.join(tmpDir, 'backend', 'package-lock.json'));
    await writeJson(path.join(tmpDir, 'frontend', 'package.json'), {
      scripts: { lint: 'oxlint', build: 'vite build' },
    });
    await writeFile(path.join(tmpDir, 'frontend', 'package-lock.json'));

    const tooling = await detector.detect(tmpDir);

    const names = tooling.packages.map((p) => p.name).sort();
    expect(names).toEqual(['backend', 'frontend']);
    const backend = tooling.packages.find((p) => p.name === 'backend')!;
    expect(backend.scripts.test).toBe('jest');
  });

  it('reports hasTsconfig and hasTypescriptDependency accurately', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      scripts: {},
      devDependencies: { typescript: '^5.0.0' },
    });
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages[0].hasTsconfig).toBe(true);
    expect(tooling.packages[0].hasTypescriptDependency).toBe(true);
  });

  it('detects an explicit non-glob workspaces array entry', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      workspaces: ['packages/shared'],
      scripts: {},
    });
    await writeJson(path.join(tmpDir, 'packages', 'shared', 'package.json'), {
      scripts: { build: 'tsc' },
    });

    const tooling = await detector.detect(tmpDir);

    const names = tooling.packages.map((p) => p.name);
    expect(names).toContain('packages/shared');
  });

  it('rejects a glob workspaces entry (no glob expansion supported)', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      workspaces: ['packages/*'],
      scripts: {},
    });
    await writeJson(path.join(tmpDir, 'packages', 'shared', 'package.json'), {
      scripts: {},
    });

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages.map((p) => p.name)).not.toContain('packages/*');
  });

  it('rejects a path-traversal workspaces entry', async () => {
    await writeJson(path.join(tmpDir, 'package.json'), {
      workspaces: ['../../etc'],
      scripts: {},
    });

    const tooling = await detector.detect(tmpDir);

    expect(tooling.packages.every((p) => p.dir !== '../../etc')).toBe(true);
  });

  it('returns no packages for an empty directory', async () => {
    const tooling = await detector.detect(tmpDir);
    expect(tooling.packages).toEqual([]);
  });
});
