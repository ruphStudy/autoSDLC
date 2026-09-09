import {
  isExcludedContentPath,
  isPathWithinWorkspace,
  isSensitivePath,
  looksBinary,
} from './file-safety.util';

describe('isPathWithinWorkspace', () => {
  const workspace = '/workspaces/project-1';

  it('allows a relative path inside the workspace', () => {
    expect(isPathWithinWorkspace('src/index.ts', workspace)).toBe(true);
  });

  it('allows the workspace root itself', () => {
    expect(isPathWithinWorkspace(workspace, workspace)).toBe(true);
  });

  it('rejects a relative traversal out of the workspace', () => {
    expect(
      isPathWithinWorkspace('../other-project/secret.env', workspace),
    ).toBe(false);
  });

  it('rejects an absolute path outside the workspace', () => {
    expect(isPathWithinWorkspace('/etc/passwd', workspace)).toBe(false);
  });

  it('rejects a sibling project workspace', () => {
    expect(
      isPathWithinWorkspace('/workspaces/project-2/file.txt', workspace),
    ).toBe(false);
  });
});

describe('isSensitivePath', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'backend/.env',
    'id_rsa',
    'ssh/id_rsa',
    'ssh/id_ed25519',
    'private.pem',
    'server.key',
    'credentials.json',
    'aws-credentials',
    'secrets.yaml',
    'client.p12',
    'cert.pfx',
  ])('flags %s as sensitive', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each([
    'package.json',
    'README.md',
    'src/index.ts',
    'prisma/schema.prisma',
  ])('does not flag %s as sensitive', (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('isExcludedContentPath', () => {
  it.each([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'poetry.lock',
    'go.sum',
    'dist/bundle.min.js',
    'dist/bundle.js.map',
  ])('excludes %s from full-content reads', (path) => {
    expect(isExcludedContentPath(path)).toBe(true);
  });

  it('does not exclude a normal source file', () => {
    expect(isExcludedContentPath('src/index.ts')).toBe(false);
  });
});

describe('looksBinary', () => {
  it('detects a NUL byte as binary', () => {
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x00, 0x03]))).toBe(true);
  });

  it('treats plain UTF-8 text as non-binary', () => {
    expect(looksBinary(Buffer.from('export const x = 1;\n', 'utf8'))).toBe(
      false,
    );
  });
});
