// Directories never worth walking into for repository-context purposes —
// dependency trees, build output, and VCS internals. Covers common
// ecosystems (Node, Python, Java/Gradle, Rust, Go) without assuming the
// repository is JS-only.
export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  'vendor',
  'target',
  'bin',
  'obj',
  '.venv',
  '__pycache__',
  '.turbo',
  '.parcel-cache',
]);

// Manifest/config files worth reading in full (bounded by
// TASK_CONTEXT_MAX_FILE_BYTES) when present — selected by existence, not
// assumed. Deliberately excludes lockfiles (package-lock.json, yarn.lock,
// pnpm-lock.yaml, Cargo.lock, poetry.lock, go.sum): package-manager
// identity matters, their full contents don't (item 63/64).
export const KEY_MANIFEST_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'nest-cli.json',
  'prisma/schema.prisma',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  'README.md',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
];

// Never read the contents of a path matching one of these, even if it's
// small and otherwise looks like a manifest — these are the files most
// likely to carry real secrets (item 61).
export const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
  /credentials/i,
  /secrets?\./i,
  /\.p12$/i,
  /\.pfx$/i,
];

// Lockfiles and other large generated/minified artifacts we never want full
// content from, even if they'd otherwise pass the manifest/size checks.
export const EXCLUDED_CONTENT_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /go\.sum$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];
