import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepositoryTreeService } from './repository-tree.service';

async function mkdtemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'repo-tree-test-'));
}

describe('RepositoryTreeService (real filesystem fixture)', () => {
  let service: RepositoryTreeService;
  let dirs: string[];

  beforeEach(() => {
    service = new RepositoryTreeService();
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

  describe('listTree', () => {
    it('returns a bounded, repository-relative tree and excludes ignored directories', async () => {
      const root = await freshDir();
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.mkdir(path.join(root, 'node_modules', 'some-pkg'), {
        recursive: true,
      });
      await fs.mkdir(path.join(root, 'dist'), { recursive: true });
      await fs.mkdir(path.join(root, '.git'), { recursive: true });
      await fs.writeFile(path.join(root, 'package.json'), '{}');
      await fs.writeFile(path.join(root, 'README.md'), '# demo');
      await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export {};');
      await fs.writeFile(
        path.join(root, 'node_modules', 'some-pkg', 'index.js'),
        'module.exports = {};',
      );
      await fs.writeFile(path.join(root, 'dist', 'bundle.js'), 'var x=1;');
      await fs.writeFile(
        path.join(root, '.git', 'HEAD'),
        'ref: refs/heads/main',
      );

      const result = await service.listTree(root, { maxEntries: 1000 });

      expect(result.truncated).toBe(false);
      expect(result.entries).toEqual(
        expect.arrayContaining(['package.json', 'README.md', 'src/index.ts']),
      );
      expect(result.entries.some((e) => e.startsWith('node_modules/'))).toBe(
        false,
      );
      expect(result.entries.some((e) => e.startsWith('dist/'))).toBe(false);
      expect(result.entries.some((e) => e.startsWith('.git/'))).toBe(false);
    });

    it('truncates once maxEntries is reached', async () => {
      const root = await freshDir();
      for (let i = 0; i < 10; i += 1) {
        await fs.writeFile(path.join(root, `file-${i}.txt`), 'x');
      }

      const result = await service.listTree(root, { maxEntries: 3 });
      expect(result.truncated).toBe(true);
      expect(result.entries).toHaveLength(3);
    });

    it('does not follow a symlink out of the workspace', async () => {
      const root = await freshDir();
      const outside = await freshDir();
      await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
      await fs.symlink(outside, path.join(root, 'escape-link'), 'dir');

      const result = await service.listTree(root, { maxEntries: 1000 });
      expect(result.entries.some((e) => e.includes('secret.txt'))).toBe(false);
    });
  });

  describe('readManifestFiles', () => {
    it('reads present manifest files and reports absent ones as simply not included', async () => {
      const root = await freshDir();
      await fs.writeFile(path.join(root, 'package.json'), '{"name":"demo"}');
      await fs.writeFile(path.join(root, 'README.md'), '# demo project');

      const result = await service.readManifestFiles(root, {
        maxFiles: 20,
        maxFileBytes: 50000,
        maxTotalBytes: 300000,
      });

      const paths = result.files.map((f) => f.path);
      expect(paths).toEqual(
        expect.arrayContaining(['package.json', 'README.md']),
      );
      expect(
        result.files.find((f) => f.path === 'package.json')?.content,
      ).toContain('"name":"demo"');
    });

    it('never reads .env, key, or credential files even if present', async () => {
      const root = await freshDir();
      await fs.writeFile(
        path.join(root, '.env'),
        'SECRET_KEY=super-secret-value',
      );
      await fs.writeFile(path.join(root, 'package.json'), '{}');

      const result = await service.readManifestFiles(root, {
        maxFiles: 20,
        maxFileBytes: 50000,
        maxTotalBytes: 300000,
      });

      expect(result.files.some((f) => f.path === '.env')).toBe(false);
      expect(JSON.stringify(result.files)).not.toContain('super-secret-value');
    });

    it('skips a manifest-path file that is actually binary', async () => {
      const root = await freshDir();
      // README.md is a KEY_MANIFEST_FILES entry — write binary content there
      // to exercise the binary-sniff guard specifically on a manifest path.
      await fs.writeFile(
        path.join(root, 'README.md'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
      );

      const result = await service.readManifestFiles(root, {
        maxFiles: 20,
        maxFileBytes: 50000,
        maxTotalBytes: 300000,
      });

      expect(result.files.some((f) => f.path === 'README.md')).toBe(false);
      expect(result.skipped).toContain('README.md');
    });

    it('truncates a file larger than maxFileBytes and records it as truncated', async () => {
      const root = await freshDir();
      await fs.writeFile(path.join(root, 'package.json'), 'x'.repeat(1000));

      const result = await service.readManifestFiles(root, {
        maxFiles: 20,
        maxFileBytes: 100,
        maxTotalBytes: 300000,
      });

      const file = result.files.find((f) => f.path === 'package.json');
      expect(file?.truncated).toBe(true);
      expect(file?.content.length).toBeLessThanOrEqual(100);
    });

    it('respects maxFiles across multiple present manifests', async () => {
      const root = await freshDir();
      await fs.writeFile(path.join(root, 'package.json'), '{}');
      await fs.writeFile(path.join(root, 'README.md'), '# x');
      await fs.writeFile(path.join(root, 'tsconfig.json'), '{}');

      const result = await service.readManifestFiles(root, {
        maxFiles: 2,
        maxFileBytes: 50000,
        maxTotalBytes: 300000,
      });

      expect(result.files).toHaveLength(2);
    });
  });
});
