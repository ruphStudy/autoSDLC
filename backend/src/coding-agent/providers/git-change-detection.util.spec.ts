import { detectChangedFiles } from './git-change-detection.util';
import { GitService } from '../../workspace/git/git.service';

describe('detectChangedFiles', () => {
  it('maps Sprint 9 ChangedFile statuses onto the coding-agent contract', async () => {
    const git = {
      getStatus: jest.fn().mockResolvedValue({
        clean: false,
        files: [
          { path: 'new-file.ts', status: 'UNTRACKED', staged: false },
          { path: 'existing.ts', status: 'MODIFIED', staged: false },
          { path: 'staged-add.ts', status: 'ADDED', staged: true },
          { path: 'removed.ts', status: 'DELETED', staged: false },
          {
            path: 'to.ts',
            status: 'RENAMED',
            staged: true,
            fromPath: 'from.ts',
          },
        ],
      }),
    } as unknown as GitService;

    const result = await detectChangedFiles(git, '/workspaces/project-1');

    expect(result).toEqual([
      { path: 'new-file.ts', changeType: 'ADDED' },
      { path: 'existing.ts', changeType: 'MODIFIED' },
      { path: 'staged-add.ts', changeType: 'ADDED' },
      { path: 'removed.ts', changeType: 'DELETED' },
      { path: 'to.ts', changeType: 'RENAMED' },
    ]);
    expect(git.getStatus).toHaveBeenCalledWith('/workspaces/project-1');
  });

  it('returns repository-relative paths only, never any absolute workspace path', async () => {
    const git = {
      getStatus: jest.fn().mockResolvedValue({
        clean: false,
        files: [{ path: 'src/file.ts', status: 'MODIFIED', staged: false }],
      }),
    } as unknown as GitService;

    const result = await detectChangedFiles(
      git,
      '/workspaces/secret-project-id',
    );
    expect(result[0].path).toBe('src/file.ts');
    expect(JSON.stringify(result)).not.toContain('/workspaces/');
  });

  it('dedupes a path that appears both staged and unstaged', async () => {
    const git = {
      getStatus: jest.fn().mockResolvedValue({
        clean: false,
        files: [
          { path: 'file.ts', status: 'ADDED', staged: true },
          { path: 'file.ts', status: 'MODIFIED', staged: false },
        ],
      }),
    } as unknown as GitService;

    const result = await detectChangedFiles(git, '/workspaces/project-1');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('file.ts');
  });

  it('returns an empty array for a clean workspace', async () => {
    const git = {
      getStatus: jest.fn().mockResolvedValue({ clean: true, files: [] }),
    } as unknown as GitService;

    const result = await detectChangedFiles(git, '/workspaces/project-1');
    expect(result).toEqual([]);
  });
});
