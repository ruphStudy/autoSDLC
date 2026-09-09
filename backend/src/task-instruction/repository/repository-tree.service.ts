import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_IGNORED_DIRECTORIES,
  KEY_MANIFEST_FILES,
} from '../task-instruction.constants';
import {
  isExcludedContentPath,
  isPathWithinWorkspace,
  isSensitivePath,
  looksBinary,
} from './file-safety.util';

export interface RepositoryTreeResult {
  entries: string[];
  truncated: boolean;
}

export interface RepositoryFileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ManifestReadResult {
  files: RepositoryFileContent[];
  skipped: string[];
  totalBytesTruncated: boolean;
}

// Safe, bounded filesystem inspection of a prepared workspace for Sprint
// 11's task-context builder. Deliberately NOT part of GitService — this is
// plain filesystem traversal, not a Git operation, and stays scoped to
// exactly what "give the planning model enough repository awareness"
// needs (item 20): a bounded file tree plus a handful of known-safe
// manifest files, never a full source dump.
@Injectable()
export class RepositoryTreeService {
  // Walks the workspace, collecting repository-relative file paths.
  // Symlinks are never followed (avoids escaping the workspace via a
  // symlink swap); ignored directories (node_modules, dist, .git, ...) are
  // pruned by name at any depth. Stops as soon as maxEntries files have
  // been collected and marks the result truncated.
  async listTree(
    workspacePath: string,
    options: { maxEntries: number },
  ): Promise<RepositoryTreeResult> {
    const root = path.resolve(workspacePath);
    const entries: string[] = [];
    let truncated = false;

    const walk = async (dir: string): Promise<void> => {
      if (truncated) return;
      let dirents: Dirent<string>[];
      try {
        dirents = await fs.readdir(dir, {
          withFileTypes: true,
          encoding: 'utf8',
        });
      } catch {
        return;
      }
      // Deterministic ordering so truncation is stable across calls.
      dirents.sort((a, b) => a.name.localeCompare(b.name));

      for (const dirent of dirents) {
        if (truncated) return;
        if (dirent.isSymbolicLink()) continue;

        if (dirent.isDirectory()) {
          if (DEFAULT_IGNORED_DIRECTORIES.has(dirent.name)) continue;
          await walk(path.join(dir, dirent.name));
          continue;
        }

        if (!dirent.isFile()) continue;

        const absolute = path.join(dir, dirent.name);
        const relative = path
          .relative(root, absolute)
          .split(path.sep)
          .join('/');
        entries.push(relative);
        if (entries.length >= options.maxEntries) {
          truncated = true;
          return;
        }
      }
    };

    await walk(root);
    return { entries, truncated };
  }

  // Reads the small, known-safe set of manifest/config files that exist in
  // the workspace (item 21) — selected by existence, never assumed. Every
  // read still goes through the same sensitive/excluded/binary/size guards
  // a general file read would, as defense in depth even though none of the
  // fixed KEY_MANIFEST_FILES names should ever match them.
  async readManifestFiles(
    workspacePath: string,
    limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number },
  ): Promise<ManifestReadResult> {
    const root = path.resolve(workspacePath);
    const files: RepositoryFileContent[] = [];
    const skipped: string[] = [];
    let totalBytes = 0;
    let totalBytesTruncated = false;

    for (const relativePath of KEY_MANIFEST_FILES) {
      if (files.length >= limits.maxFiles) break;
      if (!isPathWithinWorkspace(relativePath, root)) continue;
      if (
        isSensitivePath(relativePath) ||
        isExcludedContentPath(relativePath)
      ) {
        skipped.push(relativePath);
        continue;
      }

      const absolute = path.join(root, relativePath);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(absolute);
      } catch {
        continue; // doesn't exist in this repository — fine, selection is by existence
      }
      if (!stat.isFile()) continue;

      if (totalBytes >= limits.maxTotalBytes) {
        totalBytesTruncated = true;
        break;
      }

      const readLength = Math.min(stat.size, limits.maxFileBytes);
      const remainingBudget = limits.maxTotalBytes - totalBytes;
      const boundedLength = Math.min(readLength, remainingBudget);

      const buffer = await readBoundedBuffer(absolute, boundedLength);
      if (looksBinary(buffer)) {
        skipped.push(relativePath);
        continue;
      }

      const content = buffer.toString('utf8');
      const truncated = stat.size > boundedLength;
      files.push({ path: relativePath, content, truncated });
      totalBytes += buffer.length;
      if (stat.size > boundedLength && boundedLength < readLength) {
        totalBytesTruncated = true;
      }
    }

    return { files, skipped, totalBytesTruncated };
  }
}

async function readBoundedBuffer(
  absolutePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
