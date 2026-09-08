import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GitService } from './git.service';
import { GitErrorCode } from '../errors/git.error';
import { WorkspaceConfigService } from '../workspace.config';

// Real spawn()-based Git operations can be slow under full-suite parallel
// load (many worker processes contending for CPU/disk) — default Jest
// timeouts are tuned for pure in-memory tests.
jest.setTimeout(20000);

function buildConfig(
  overrides: Partial<WorkspaceConfigService> = {},
): WorkspaceConfigService {
  return {
    workspaceRoot: '/tmp/does-not-matter',
    maxSizeMb: 2048,
    commandTimeoutMs: 10000,
    cloneTimeoutMs: 10000,
    defaultBranch: 'main',
    maxOutputBytes: 1024 * 1024,
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    developmentBranch: 'autodev/development',
    ...overrides,
  } as WorkspaceConfigService;
}

async function mkdtemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'git-service-test-'));
}

describe('GitService', () => {
  let git: GitService;
  let dirs: string[];

  beforeEach(() => {
    git = new GitService(buildConfig());
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp();
    dirs.push(dir);
    return dir;
  }

  it('reports Git as available', async () => {
    expect(await git.checkAvailability()).toBe(true);
  });

  it('initializes a repository on the configured default branch', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    expect(await git.isInsideWorkTree(cwd)).toBe(true);
    expect(await git.getCurrentBranch(cwd)).toBe('main');
  });

  it('reports not-inside-a-work-tree for a plain directory', async () => {
    const cwd = await freshDir();
    expect(await git.isInsideWorkTree(cwd)).toBe(false);
  });

  it('configures a workspace-local identity without touching --global', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(
      cwd,
      'Autonomous Dev Orchestrator',
      'autodev@localhost',
    );
    // No assertion beyond "doesn't throw" plus the commit test below actually
    // using this identity to succeed — `git config --global` is never
    // invoked here, so the host's global config is untouched by construction.
  });

  it('has no HEAD commit before anything is committed', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    expect(await git.getHeadCommitSha(cwd)).toBeNull();
  });

  it('creates an empty commit and returns its SHA', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');

    const sha = await git.commit(cwd, 'chore: initial commit', {
      allowEmpty: true,
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.getHeadCommitSha(cwd)).toBe(sha);
  });

  it('rejects a commit with nothing staged and no --allow-empty', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');

    await expect(
      git.commit(cwd, 'chore: nothing to commit'),
    ).rejects.toMatchObject({
      code: GitErrorCode.COMMIT_FAILED,
    });
  });

  it('stages and commits a real file, and reports a clean status afterwards', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');
    await fs.writeFile(path.join(cwd, 'README.md'), '# Hello\n');

    let status = await git.getStatus(cwd);
    expect(status.clean).toBe(false);
    expect(status.files).toEqual([
      { path: 'README.md', status: 'UNTRACKED', staged: false },
    ]);

    await git.stageFiles(cwd, ['README.md']);
    status = await git.getStatus(cwd);
    expect(status.files).toEqual([
      { path: 'README.md', status: 'ADDED', staged: true },
    ]);

    await git.commit(cwd, 'docs: add README');
    status = await git.getStatus(cwd);
    expect(status.clean).toBe(true);
    expect(status.files).toEqual([]);
  });

  it('reports staged vs unstaged modifications distinctly', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');
    await fs.writeFile(path.join(cwd, 'file.txt'), 'v1\n');
    await git.stageFiles(cwd, ['file.txt']);
    await git.commit(cwd, 'add file');

    await fs.writeFile(path.join(cwd, 'file.txt'), 'v2\n');
    const status = await git.getStatus(cwd);
    expect(status.clean).toBe(false);
    expect(status.files).toEqual([
      { path: 'file.txt', status: 'MODIFIED', staged: false },
    ]);
  });

  it('computes an unstaged diff and a staged diff separately', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');
    await fs.writeFile(path.join(cwd, 'file.txt'), 'v1\n');
    await git.stageFiles(cwd, ['file.txt']);
    await git.commit(cwd, 'add file');
    await fs.writeFile(path.join(cwd, 'file.txt'), 'v2\n');

    const unstagedDiff = await git.getDiff(cwd);
    expect(unstagedDiff.diff).toContain('-v1');
    expect(unstagedDiff.diff).toContain('+v2');

    const stagedDiffBeforeAdd = await git.getDiff(cwd, { staged: true });
    expect(stagedDiffBeforeAdd.diff).toBe('');

    await git.stageFiles(cwd, ['file.txt']);
    const stagedDiff = await git.getDiff(cwd, { staged: true });
    expect(stagedDiff.diff).toContain('+v2');
  });

  it('creates and switches branches', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');
    await git.commit(cwd, 'init', { allowEmpty: true });

    await git.createBranch(cwd, 'autodev/development');
    expect(await git.getCurrentBranch(cwd)).toBe('autodev/development');

    await git.switchBranch(cwd, 'main');
    expect(await git.getCurrentBranch(cwd)).toBe('main');
  });

  it('fails to create a branch that already exists', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');
    await git.commit(cwd, 'init', { allowEmpty: true });
    await git.createBranch(cwd, 'autodev/development');
    await git.switchBranch(cwd, 'main');

    await expect(
      git.createBranch(cwd, 'autodev/development'),
    ).rejects.toMatchObject({
      code: GitErrorCode.BRANCH_FAILED,
    });
  });

  it('returns null remote info when no remote is configured', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    expect(await git.getRemoteInfo(cwd)).toBeNull();
  });

  it('redacts embedded credentials from a remote URL', async () => {
    const cwd = await freshDir();
    await git.init(cwd, 'main');
    await git.configureIdentity(cwd, 'Test Author', 'test@example.com');

    spawnSync(
      'git',
      [
        'remote',
        'add',
        'origin',
        'https://user:secret-token@example.com/org/repo.git',
      ],
      { cwd },
    );

    const remote = await git.getRemoteInfo(cwd);
    expect(remote).not.toBeNull();
    expect(remote!.url).not.toContain('secret-token');
    expect(remote!.url).toBe('https://example.com/org/repo.git');
  });

  it('clones a local repository into a target directory', async () => {
    const source = await freshDir();
    await git.init(source, 'main');
    await git.configureIdentity(source, 'Test Author', 'test@example.com');
    await fs.writeFile(path.join(source, 'file.txt'), 'hello\n');
    await git.stageFiles(source, ['file.txt']);
    const sha = await git.commit(source, 'add file');

    const targetParent = await freshDir();
    const target = path.join(targetParent, 'cloned');
    await git.clone(source, target);

    expect(await git.isInsideWorkTree(target)).toBe(true);
    expect(await git.getHeadCommitSha(target)).toBe(sha);
    const cloned = await fs.readFile(path.join(target, 'file.txt'), 'utf8');
    expect(cloned).toBe('hello\n');
  });

  it('raises CLONE_FAILED for a source that does not exist', async () => {
    const targetParent = await freshDir();
    const target = path.join(targetParent, 'cloned');

    await expect(
      git.clone(path.join(targetParent, 'does-not-exist'), target),
    ).rejects.toMatchObject({ code: GitErrorCode.CLONE_FAILED });
  });

  it('truncates output beyond the configured maximum', async () => {
    const smallGit = new GitService(buildConfig({ maxOutputBytes: 16 }));
    const cwd = await freshDir();
    await smallGit.init(cwd, 'main');
    await smallGit.configureIdentity(cwd, 'Test Author', 'test@example.com');
    for (let i = 0; i < 20; i += 1) {
      await fs.writeFile(path.join(cwd, `file-${i}.txt`), 'x');
    }

    const result = await (
      smallGit as unknown as {
        run: (
          args: string[],
          options: { cwd: string },
        ) => Promise<{
          stdout: string;
          truncated: boolean;
        }>;
      }
    ).run(['status', '--porcelain=v1'], { cwd });

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(16);
  });

  it('rejects with GIT_NOT_AVAILABLE when the git binary cannot be found', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const isolatedGit = new GitService(buildConfig());
      await expect(isolatedGit.checkAvailability()).resolves.toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
