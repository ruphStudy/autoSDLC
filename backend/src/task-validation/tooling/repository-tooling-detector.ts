import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  DetectedPackage,
  PackageManager,
  RepositoryTooling,
} from './tooling.types';

// Conventional subdirectories this platform's own generated projects use
// (see architecture prompts: NestJS backend + React frontend). Deliberately
// NOT a generic multi-ecosystem build-system engine (item 16/17) — just
// enough structure detection for the Node/TS projects this platform
// actually produces, plus a root package.json and a non-glob "workspaces"
// array for anything else reasonable.
const CONVENTIONAL_SUBDIRS = ['backend', 'frontend'];

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Never guesses randomly (item 15): prefers an explicit, valid
// `packageManager` field (Corepack's "name@version" convention), then falls
// back to lockfile presence in the package's own directory, then the
// nearest ancestor lockfile, then defaults to npm (the safest universal
// choice — `npm run <script>` works whenever a package.json exists at all).
async function detectPackageManagerForDir(
  workspacePath: string,
  dir: string,
  rootPackageJson: Record<string, unknown> | null,
): Promise<PackageManager> {
  const absDir = path.join(workspacePath, dir);
  const packageJson = await readJson(path.join(absDir, 'package.json'));
  const explicit =
    packageJson?.packageManager ?? rootPackageJson?.packageManager;
  if (typeof explicit === 'string') {
    const name = explicit.split('@')[0];
    if (
      name === 'npm' ||
      name === 'yarn' ||
      name === 'pnpm' ||
      name === 'bun'
    ) {
      return name;
    }
  }

  const lockfileChecks: [string, PackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ];
  for (const [file, manager] of lockfileChecks) {
    if (await fileExists(path.join(absDir, file))) return manager;
  }
  for (const [file, manager] of lockfileChecks) {
    if (await fileExists(path.join(workspacePath, file))) return manager;
  }
  return 'npm';
}

async function detectPackageAt(
  workspacePath: string,
  dir: string,
  name: string,
  rootPackageJson: Record<string, unknown> | null,
): Promise<DetectedPackage | null> {
  const absDir = path.join(workspacePath, dir);
  const packageJson = await readJson(path.join(absDir, 'package.json'));
  if (!packageJson) return null;

  const scripts =
    typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? (packageJson.scripts as Record<string, string>)
      : {};
  const deps = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  return {
    name,
    dir,
    packageManager: await detectPackageManagerForDir(
      workspacePath,
      dir,
      rootPackageJson,
    ),
    scripts,
    hasTsconfig: await fileExists(path.join(absDir, 'tsconfig.json')),
    hasTypescriptDependency: Object.prototype.hasOwnProperty.call(
      deps,
      'typescript',
    ),
  };
}

@Injectable()
export class RepositoryToolingDetector {
  async detect(workspacePath: string): Promise<RepositoryTooling> {
    const rootPackageJson = await readJson(
      path.join(workspacePath, 'package.json'),
    );
    const packages: DetectedPackage[] = [];

    const root = await detectPackageAt(
      workspacePath,
      '.',
      'root',
      rootPackageJson,
    );
    if (root) packages.push(root);

    for (const subdir of CONVENTIONAL_SUBDIRS) {
      const pkg = await detectPackageAt(
        workspacePath,
        subdir,
        subdir,
        rootPackageJson,
      );
      if (pkg) packages.push(pkg);
    }

    // A simple, non-glob "workspaces" array (npm/yarn classic form) — no
    // glob expansion, matching item 16's "do not build a generic build-
    // system engine" guidance. Path-traversal entries are rejected outright
    // (defense in depth — this is repository-controlled content, not truly
    // trusted input).
    const workspaces = rootPackageJson?.workspaces;
    const workspaceDirs = Array.isArray(workspaces)
      ? workspaces.filter(
          (w): w is string =>
            typeof w === 'string' &&
            !w.includes('*') &&
            !path.isAbsolute(w) &&
            !path.normalize(w).split(path.sep).includes('..'),
        )
      : [];
    for (const dir of workspaceDirs) {
      if (packages.some((p) => p.dir === dir)) continue;
      const pkg = await detectPackageAt(
        workspacePath,
        dir,
        dir,
        rootPackageJson,
      );
      if (pkg) packages.push(pkg);
    }

    return { packages };
  }
}
