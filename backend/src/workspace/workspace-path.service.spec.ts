import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspacePathService } from './workspace-path.service';
import { GitErrorCode } from './errors/git.error';
import { WorkspaceConfigService } from './workspace.config';

const VALID_PROJECT_ID = '11111111-2222-4333-8444-555555555555';

describe('WorkspacePathService', () => {
  let root: string;
  let service: WorkspacePathService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-root-test-'));
    service = new WorkspacePathService({
      workspaceRoot: root,
    } as WorkspaceConfigService);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('resolveProjectWorkspacePath', () => {
    it('resolves a valid UUID project id to a path under the root', () => {
      const resolved = service.resolveProjectWorkspacePath(VALID_PROJECT_ID);
      expect(resolved).toBe(path.resolve(root, VALID_PROJECT_ID));
    });

    it('rejects a non-UUID project id', () => {
      expect(() =>
        service.resolveProjectWorkspacePath('../etc/passwd'),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });

    it('rejects a project id crafted to traverse out of the root', () => {
      expect(() =>
        service.resolveProjectWorkspacePath('../../../../etc'),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });

    it('rejects a project name instead of a UUID (never derive paths from names)', () => {
      expect(() =>
        service.resolveProjectWorkspacePath('My Cool Project'),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });
  });

  describe('assertWithinRoot', () => {
    it('accepts a direct child of the root', () => {
      expect(() =>
        service.assertWithinRoot(path.join(root, 'child')),
      ).not.toThrow();
    });

    it('rejects the root itself', () => {
      expect(() => service.assertWithinRoot(root)).toThrow(
        expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }),
      );
    });

    it('rejects a path outside the root', () => {
      expect(() =>
        service.assertWithinRoot(path.join(root, '..', 'sibling')),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });

    it('rejects an absolute path entirely unrelated to the root', () => {
      expect(() => service.assertWithinRoot('/etc/passwd')).toThrow(
        expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }),
      );
    });
  });

  describe('assertRealPathWithinRoot (symlink-aware)', () => {
    it('passes for a real (non-symlinked) child that exists', async () => {
      const child = path.join(root, 'child');
      await fs.mkdir(child);
      await expect(
        service.assertRealPathWithinRoot(child),
      ).resolves.toBeUndefined();
    });

    it('falls back to the plain check when the candidate does not exist yet', async () => {
      const child = path.join(root, 'not-yet-created');
      await expect(
        service.assertRealPathWithinRoot(child),
      ).resolves.toBeUndefined();
    });

    it('rejects a symlink inside the root that resolves outside it', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-root-'));
      try {
        const link = path.join(root, 'escape-link');
        await fs.symlink(outside, link, 'dir');
        await expect(
          service.assertRealPathWithinRoot(link),
        ).rejects.toMatchObject({
          code: GitErrorCode.PATH_VIOLATION,
        });
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });
  });

  describe('assertSafeRelativePath', () => {
    it('accepts a plain relative path', () => {
      expect(service.assertSafeRelativePath('src/index.ts')).toBe(
        'src/index.ts',
      );
    });

    it('rejects an absolute path', () => {
      expect(() => service.assertSafeRelativePath('/etc/passwd')).toThrow(
        expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }),
      );
    });

    it('rejects a path containing ..', () => {
      expect(() => service.assertSafeRelativePath('../outside.txt')).toThrow(
        expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }),
      );
    });
  });

  describe('ensureDirectory / exists', () => {
    it('creates a directory under the root and reports it as existing', async () => {
      const target = path.join(root, 'created');
      await service.ensureDirectory(target);
      expect(await service.exists(target)).toBe(true);
    });

    it('reports a non-existent path as not existing', async () => {
      expect(await service.exists(path.join(root, 'nope'))).toBe(false);
    });

    it('refuses to create a directory outside the root', async () => {
      await expect(
        service.ensureDirectory(path.join(root, '..', 'escaped')),
      ).rejects.toMatchObject({ code: GitErrorCode.PATH_VIOLATION });
    });
  });

  describe('removeWorkspaceDirectory', () => {
    it('recursively deletes a workspace directory under the root', async () => {
      const target = path.join(root, VALID_PROJECT_ID);
      await fs.mkdir(path.join(target, 'nested'), { recursive: true });
      await fs.writeFile(path.join(target, 'nested', 'file.txt'), 'x');

      await service.removeWorkspaceDirectory(target);
      expect(await service.exists(target)).toBe(false);
    });

    it('is a no-op when the target does not exist', async () => {
      await expect(
        service.removeWorkspaceDirectory(path.join(root, 'never-existed')),
      ).resolves.toBeUndefined();
    });

    it('refuses to delete the workspace root itself', async () => {
      await expect(
        service.removeWorkspaceDirectory(root),
      ).rejects.toMatchObject({
        code: GitErrorCode.PATH_VIOLATION,
      });
      expect(await service.exists(root)).toBe(true);
    });

    it('refuses to delete a path outside the root', async () => {
      const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), 'outside-delete-'),
      );
      try {
        await expect(
          service.removeWorkspaceDirectory(outside),
        ).rejects.toMatchObject({
          code: GitErrorCode.PATH_VIOLATION,
        });
        expect(await service.exists(outside)).toBe(true);
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });

    it('refuses to delete through a symlink that escapes the root, even if constructed after resolution', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-swap-'));
      await fs.writeFile(
        path.join(outside, 'important.txt'),
        'do not delete me',
      );
      try {
        const link = path.join(root, 'sibling-swap');
        await fs.symlink(outside, link, 'dir');

        await expect(
          service.removeWorkspaceDirectory(link),
        ).rejects.toMatchObject({
          code: GitErrorCode.PATH_VIOLATION,
        });
        expect(
          await fs.readFile(path.join(outside, 'important.txt'), 'utf8'),
        ).toBe('do not delete me');
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });
  });
});
