import * as path from 'node:path';
import {
  resolveProjectWorkspacePath,
  assertWithinRoot,
} from './workspace-path.util';
import { GitErrorCode } from './errors/git.error';

const VALID_PROJECT_ID = '11111111-2222-4333-8444-555555555555';

describe('workspace-path.util', () => {
  describe('resolveProjectWorkspacePath', () => {
    it('resolves a valid UUID under the given root', () => {
      const resolved = resolveProjectWorkspacePath(
        '/tmp/root',
        VALID_PROJECT_ID,
      );
      expect(resolved).toBe(path.resolve('/tmp/root', VALID_PROJECT_ID));
    });

    it('rejects a non-UUID id (used by ProjectsService cleanup-on-delete)', () => {
      expect(() =>
        resolveProjectWorkspacePath('/tmp/root', 'not-a-uuid'),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });

    it('rejects an id that attempts path traversal', () => {
      expect(() =>
        resolveProjectWorkspacePath('/tmp/root', '../../../etc/passwd'),
      ).toThrow(expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }));
    });
  });

  describe('assertWithinRoot', () => {
    it('rejects the root itself', () => {
      expect(() => assertWithinRoot('/tmp/root', '/tmp/root')).toThrow(
        expect.objectContaining({ code: GitErrorCode.PATH_VIOLATION }),
      );
    });

    it('accepts a direct child', () => {
      expect(() =>
        assertWithinRoot('/tmp/root/child', '/tmp/root'),
      ).not.toThrow();
    });
  });
});
