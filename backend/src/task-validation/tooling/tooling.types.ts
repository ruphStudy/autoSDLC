export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

// One Node/TS package discovered in the repository (root, or a conventional
// subdirectory such as "backend"/"frontend", or an explicit non-glob entry
// from a "workspaces" array). `dir` is repository-relative ("." for root).
export interface DetectedPackage {
  name: string;
  dir: string;
  packageManager: PackageManager;
  scripts: Record<string, string>;
  hasTsconfig: boolean;
  hasTypescriptDependency: boolean;
}

export interface RepositoryTooling {
  packages: DetectedPackage[];
}
