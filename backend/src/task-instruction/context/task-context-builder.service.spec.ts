import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskContextBuilder } from './task-context-builder.service';
import { GitService } from '../../workspace/git/git.service';
import { RepositoryTreeService } from '../repository/repository-tree.service';
import { TaskInstructionConfigService } from '../task-instruction.config';
import { WorkspaceConfigService } from '../../workspace/workspace.config';
import { TaskInstructionErrorCode } from '../errors/task-instruction.error';

function buildGitConfig(): WorkspaceConfigService {
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
  } as WorkspaceConfigService;
}

function buildInstructionConfig(
  overrides: Partial<TaskInstructionConfigService> = {},
): TaskInstructionConfigService {
  return {
    maxTreeEntries: 1000,
    maxFiles: 20,
    maxFileBytes: 50000,
    maxTotalBytes: 300000,
    recentCommits: 10,
    maxInstructionChars: 50000,
    ...overrides,
  } as TaskInstructionConfigService;
}

function buildFullTaskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    key: 'S1-T1',
    title: 'Create user model',
    description: 'Implement the User entity.',
    acceptanceCriteria: ['A user can be created.'],
    validationExpectations: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    requirementIds: ['FR-001'],
    architectureAreas: ['backendArchitecture'],
    dependencies: [
      {
        dependsOnTask: {
          id: 'task-0',
          key: 'S1-T0',
          title: 'Setup project',
          status: 'PASSED',
        },
      },
    ],
    sprint: {
      id: 'sprint-1',
      number: 1,
      title: 'Foundations',
      objective: 'Stand up the core model.',
    },
    sprintPlan: {
      id: 'plan-1',
      version: 1,
      summary: 'Plan summary.',
      strategy: 'Foundations first.',
      project: {
        id: 'project-1',
        name: 'Demo',
        brief: 'Build a demo.',
        repositoryType: 'NEW',
      },
      architecture: {
        id: 'architecture-1',
        version: 1,
        summary: 'Architecture summary.',
        backendArchitecture: { framework: 'NestJS' },
        architectureDecisions: [
          {
            id: 'ADR-001',
            title: 'Use PostgreSQL',
            decision: 'Use PostgreSQL + Prisma.',
          },
        ],
        projectAnalysis: {
          id: 'analysis-1',
          version: 1,
          summary: 'Analysis summary.',
          functionalRequirements: [
            {
              id: 'FR-001',
              title: 'User accounts',
              description: 'Users can register.',
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

describe('TaskContextBuilder (real Git + filesystem fixture)', () => {
  let prisma: {
    task: { findUnique: jest.Mock };
    agentJob: { findFirst: jest.Mock };
  };
  let git: GitService;
  let builder: TaskContextBuilder;
  let dirs: string[];

  beforeEach(() => {
    prisma = {
      task: { findUnique: jest.fn() },
      agentJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    git = new GitService(buildGitConfig());
    builder = new TaskContextBuilder(
      prisma as never,
      git,
      new RepositoryTreeService(),
      buildInstructionConfig(),
    );
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function freshRepo(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-context-test-'));
    dirs.push(dir);
    await git.init(dir, 'main');
    await git.configureIdentity(dir, 'Test Author', 'test@example.com');
    return dir;
  }

  it('throws TASK_NOT_FOUND when the task does not exist', async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    const repo = await freshRepo();
    await expect(builder.build('missing-task', repo)).rejects.toMatchObject({
      code: TaskInstructionErrorCode.TASK_NOT_FOUND,
    });
  });

  it('resolves the exact lineage chain: Task -> SprintPlan -> Architecture -> ProjectAnalysis', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"demo"}');
    await git.stageFiles(repo, ['package.json']);
    await git.commit(repo, 'chore: init');

    const context = await builder.build('task-1', repo);

    expect(context.sprintPlan.id).toBe('plan-1');
    expect(context.architecture.id).toBe('architecture-1');
    expect(context.projectAnalysis.id).toBe('analysis-1');
    expect(context.sprint.objective).toBe('Stand up the core model.');
  });

  it('includes the Task acceptance criteria, validation expectations, and requirement ids', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();

    const context = await builder.build('task-1', repo);

    expect(context.task.acceptanceCriteria).toEqual(['A user can be created.']);
    expect(context.task.validationExpectations).toEqual([
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ]);
    expect(context.task.requirementIds).toEqual(['FR-001']);
    expect(context.task.relevantRequirements).toEqual([
      {
        id: 'FR-001',
        title: 'User accounts',
        description: 'Users can register.',
      },
    ]);
  });

  it('includes dependency Task context without fabricating an AgentJob result when none exists', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();

    const context = await builder.build('task-1', repo);

    expect(context.dependencies).toEqual([
      {
        taskKey: 'S1-T0',
        title: 'Setup project',
        status: 'PASSED',
        lastAttempt: undefined,
      },
    ]);
  });

  it('includes a dependency Task result when a prior AgentJob exists', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    prisma.agentJob.findFirst.mockResolvedValue({
      status: 'SUCCEEDED',
      summary: 'Setup completed cleanly.',
    });
    const repo = await freshRepo();

    const context = await builder.build('task-1', repo);

    expect(context.dependencies[0].lastAttempt).toEqual({
      status: 'SUCCEEDED',
      summary: 'Setup completed cleanly.',
    });
  });

  it('selects only the architecture areas the Task actually references', async () => {
    prisma.task.findUnique.mockResolvedValue(
      buildFullTaskRow({
        architectureAreas: ['backendArchitecture', 'not-a-real-field'],
      }),
    );
    const repo = await freshRepo();

    const context = await builder.build('task-1', repo);

    expect(context.architecture.relevantAreas).toEqual([
      { area: 'backendArchitecture', content: { framework: 'NestJS' } },
    ]);
  });

  it('captures live Git branch, HEAD SHA, and clean status from the real repository', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();
    const sha = await git.commit(repo, 'chore: init', { allowEmpty: true });
    await git.createBranch(repo, 'autodev/development');

    const context = await builder.build('task-1', repo);

    expect(context.repository.branch).toBe('autodev/development');
    expect(context.repository.headCommitSha).toBe(sha);
    expect(context.repository.clean).toBe(true);
  });

  it('produces a bounded repository tree that excludes ignored directories', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();
    await fs.mkdir(path.join(repo, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'x');
    await fs.writeFile(path.join(repo, 'src.ts'), 'export {};');

    const context = await builder.build('task-1', repo);

    expect(context.repository.tree.entries).toContain('src.ts');
    expect(
      context.repository.tree.entries.some((e) => e.includes('node_modules')),
    ).toBe(false);
  });

  it('excludes sensitive files from the manifest read even if present', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();
    await fs.writeFile(path.join(repo, '.env'), 'SECRET=top-secret-value');
    await fs.writeFile(path.join(repo, 'package.json'), '{}');

    const context = await builder.build('task-1', repo);

    expect(context.repository.manifests.some((m) => m.path === '.env')).toBe(
      false,
    );
    expect(JSON.stringify(context.repository.manifests)).not.toContain(
      'top-secret-value',
    );
  });

  it('includes bounded recent commit history', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repo = await freshRepo();
    await git.commit(repo, 'chore: first', { allowEmpty: true });
    await git.commit(repo, 'feat: second', { allowEmpty: true });

    const context = await builder.build('task-1', repo);

    expect(context.repository.recentCommits.length).toBeGreaterThanOrEqual(2);
    expect(context.repository.recentCommits[0].message).toBe('feat: second');
  });

  it('cannot read another project workspace — only inspects the given workspacePath', async () => {
    prisma.task.findUnique.mockResolvedValue(buildFullTaskRow());
    const repoA = await freshRepo();
    const repoB = await freshRepo();
    await fs.writeFile(
      path.join(repoB, 'other-project-secret.txt'),
      'not for task-1',
    );

    const context = await builder.build('task-1', repoA);

    expect(
      context.repository.tree.entries.some((e) =>
        e.includes('other-project-secret'),
      ),
    ).toBe(false);
  });
});
