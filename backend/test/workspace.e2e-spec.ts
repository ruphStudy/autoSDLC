import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import {
  PLANNING_AI_PROVIDER,
  PlanningOperation,
} from '../src/ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../src/ai/planning/contracts/planning-provider.interface';
import { JobWorkerService } from '../src/jobs/job-worker.service';
import { WorkspaceConfigService } from '../src/workspace/workspace.config';

function validAnalysisContent() {
  return {
    summary: 'A mock interview platform.',
    targetUsers: [{ name: 'Job seekers', description: 'Engineers', needs: [] }],
    goals: [{ title: 'Confidence', description: 'Feel prepared' }],
    features: [
      {
        name: 'Mock interviews',
        description: 'AI-led sessions',
        priority: 'must_have',
      },
    ],
    functionalRequirements: [
      {
        id: 'FR-001',
        title: 'Start interview',
        description: 'Start a session',
        priority: 'must_have',
      },
    ],
    nonFunctionalRequirements: [
      { category: 'performance', requirement: 'Fast responses' },
    ],
    assumptions: [{ assumption: 'Users have a mic.' }],
    risks: [{ risk: 'Audio quality', severity: 'medium' }],
    unresolvedQuestions: [
      { question: 'Record sessions?', importance: 'medium' },
    ],
    integrations: [
      { name: 'STT API', purpose: 'Transcription', required: true },
    ],
  };
}

function analysisResult() {
  return {
    data: validAnalysisContent(),
    usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.PROJECT_ANALYSIS,
      latencyMs: 42,
      attempts: 1,
      requestId: 'req-analysis-1',
    },
  };
}

function validArchitectureContent() {
  return {
    summary: 'A modular NestJS monolith with a React frontend.',
    frontendArchitecture: {
      framework: 'React',
      language: 'TypeScript',
      componentStrategy: 'Hooks-based.',
    },
    backendArchitecture: {
      framework: 'NestJS',
      language: 'TypeScript',
      architecturalStyle: 'Modular monolith',
      modules: [
        { name: 'interviews', responsibility: 'Manages interview sessions.' },
      ],
    },
    apiArchitecture: {
      style: 'REST',
      conventions: [],
      majorResourceGroups: [],
    },
    databaseArchitecture: {
      databaseType: 'Relational',
      technology: 'PostgreSQL',
      rationale: 'Consistency for a CRUD-heavy MVP.',
      majorEntities: [],
    },
    authenticationArchitecture: {
      authenticationMethod: 'JWT',
      tokenOrSessionStrategy: 'Access + refresh tokens.',
      authorizationModel: 'Owner-only access.',
    },
    integrationArchitecture: [],
    infrastructureArchitecture: {
      runtimeComponents: ['API server', 'PostgreSQL'],
    },
    deploymentArchitecture: {
      environments: ['production'],
      deploymentStrategy: 'Single-region container deployment.',
      ciCdApproach: 'CI runs lint/test/build on every push.',
      configurationStrategy: 'Environment variables.',
      secretsStrategy: 'Managed secret store.',
    },
    securityArchitecture: {
      controls: [{ area: 'Auth', recommendation: 'bcrypt hashing.' }],
    },
    testingStrategy: {
      unitTesting: { approach: 'Jest' },
      integrationTesting: { approach: 'Supertest' },
      e2eTesting: { approach: 'Supertest' },
    },
    nonFunctionalDecisions: [],
    architectureDecisions: [
      {
        id: 'ADR-001',
        title: 'Modular monolith',
        context: 'Small MVP team.',
        decision: 'One deployable app.',
        rationale: 'Operational simplicity.',
      },
    ],
    requirementTraceability: [
      { requirementId: 'FR-001', architectureAreas: ['backendArchitecture'] },
    ],
    unresolvedQuestions: [],
    constraints: [],
  };
}

function architectureResult() {
  return {
    data: validArchitectureContent(),
    usage: { inputTokens: 700, outputTokens: 500, totalTokens: 1200 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.ARCHITECTURE_GENERATION,
      latencyMs: 84,
      attempts: 1,
      requestId: 'req-architecture-1',
    },
  };
}

function validSprintPlanContent() {
  return {
    summary: 'Deliver the interview flow across two sprints.',
    strategy: 'Build foundations first, then layer features.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Stand up the core interview session model.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Create interview session model',
            description: 'Implement the session entity and start endpoint.',
            dependencies: [],
            acceptanceCriteria: ['A session can be started.'],
            validationExpectations: [
              {
                type: 'unit_test',
                description: 'Unit tests pass.',
                required: true,
              },
            ],
            requirementIds: ['FR-001'],
            architectureAreas: ['backendArchitecture'],
          },
        ],
      },
    ],
  };
}

function sprintPlanResult() {
  return {
    data: validSprintPlanContent(),
    usage: { inputTokens: 900, outputTokens: 700, totalTokens: 1600 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.SPRINT_PLANNING,
      latencyMs: 120,
      attempts: 1,
      requestId: 'req-sprint-plan-1',
    },
  };
}

describe('Workspace (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobWorkerService;
  let workspaceRoot: string;
  const createdEmails: string[] = [];
  const generateStructuredOutput = jest.fn();

  const stubProvider: PlanningAIProvider = {
    generateStructuredOutput,
    healthCheck: jest.fn(),
  };

  const uniqueEmail = (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  const registerUser = async (label: string) => {
    const email = uniqueEmail(label);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Sup3rSecret1' });
    return res.body.accessToken as string;
  };

  const createProject = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Interview Prep Platform',
        brief: 'Build a mock interview platform.',
        ...overrides,
      });
    return res.body.id as string;
  };

  const approveThroughStartDevelopment = async (
    token: string,
    projectId: string,
  ) => {
    generateStructuredOutput.mockResolvedValueOnce(analysisResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/analysis/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/ANALYSIS`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    generateStructuredOutput.mockResolvedValueOnce(architectureResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/architecture/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/ARCHITECTURE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    generateStructuredOutput.mockResolvedValueOnce(sprintPlanResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/SPRINT_PLAN`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
  };

  const buildFullyApprovedProject = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const projectId = await createProject(token, overrides);
    await approveThroughStartDevelopment(token, projectId);
    return projectId;
  };

  const prepareAndRun = async (token: string, projectId: string) => {
    const prepareRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    return prepareRes;
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-workspace-e2e-'),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubProvider)
      .overrideProvider(WorkspaceConfigService)
      .useValue({
        workspaceRoot,
        maxSizeMb: 2048,
        commandTimeoutMs: 60000,
        cloneTimeoutMs: 60000,
        defaultBranch: 'main',
        maxOutputBytes: 1024 * 1024,
        authorName: 'Autonomous Dev Orchestrator',
        authorEmail: 'autodev@localhost',
        developmentBranch: 'autodev/development',
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    worker = moduleFixture.get(JobWorkerService);
  });

  beforeEach(() => {
    generateStructuredOutput.mockReset();
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('rejects unauthenticated access to every workspace route', async () => {
    await request(app.getHttpServer()).get('/projects/x/workspace').expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/workspace/prepare')
      .expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/workspace/validate')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/workspace/status')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/workspace/diff')
      .expect(401);
    await request(app.getHttpServer())
      .delete('/projects/x/workspace')
      .expect(401);
  });

  it('reports NOT_PREPARED before anything happens, without exposing a filesystem path', async () => {
    const token = await registerUser('ws-not-prepared');
    const projectId = await createProject(token);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/workspace`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('NOT_PREPARED');
    expect(res.body).not.toHaveProperty('workspacePath');
  });

  it('blocks preparing a workspace before Start Development is approved', async () => {
    const token = await registerUser('ws-not-approved');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  describe('NEW repository — full lifecycle', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('ws-new-repo');
      projectId = await buildFullyApprovedProject(token);
    });

    it('prepares a NEW repository end to end: init, empty commit, development branch, READY', async () => {
      await prepareAndRun(token, projectId);

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.status).toBe('READY');
      expect(res.body.developmentBranch).toBe('autodev/development');
      expect(res.body.currentBranch).toBe('autodev/development');
      expect(res.body.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(res.body.clean).toBe(true);
      expect(res.body).not.toHaveProperty('workspacePath');

      // Never touches the protected main/master branch — only the
      // isolated development branch exists as HEAD after preparation.
      const dir = path.join(workspaceRoot, projectId);
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('reports a valid readiness result via the explicit validate endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/workspace/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.ready).toBe(true);
      expect(res.body.gitRepository).toBe(true);
      expect(res.body.issues).toEqual([]);
    });

    it('returns a clean git status with no changed files', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ clean: true, files: [] });
    });

    it('returns an empty diff', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace/diff`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.diff).toBe('');
    });

    it('rejects preparing again while the workspace is already READY', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/workspace/prepare`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('refuses to clean up once the worktree has uncommitted changes', async () => {
      const dir = path.join(workspaceRoot, projectId);
      await fs.writeFile(path.join(dir, 'untracked.txt'), 'dirty');

      await request(app.getHttpServer())
        .delete(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      // The refusal must not have deleted anything.
      await fs.access(path.join(dir, 'untracked.txt'));
      await fs.rm(path.join(dir, 'untracked.txt'));
    });

    it('cleans up a clean workspace and resets it to NOT_PREPARED, removing the directory', async () => {
      const dir = path.join(workspaceRoot, projectId);

      const res = await request(app.getHttpServer())
        .delete(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.status).toBe('NOT_PREPARED');
      expect(res.body.developmentBranch).toBeNull();
      await expect(fs.access(dir)).rejects.toThrow();
    });

    it('can be prepared again after cleanup', async () => {
      await prepareAndRun(token, projectId);

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.status).toBe('READY');
    });
  });

  describe('EXISTING repository — validation-time rejection', () => {
    it('marks the workspace FAILED with INVALID_REMOTE for an unsupported repository URL, without ever attempting a network clone', async () => {
      const token = await registerUser('ws-bad-url');
      const projectId = await buildFullyApprovedProject(token, {
        repositoryType: 'EXISTING',
        repositoryUrl: 'http://example.com/org/repo.git',
      });

      await prepareAndRun(token, projectId);

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.errorCode).toBe('invalid_remote');
    });

    it('marks the workspace FAILED with WORKSPACE_INVALID when EXISTING has no URL configured', async () => {
      const token = await registerUser('ws-no-url');
      const projectId = await buildFullyApprovedProject(token, {
        repositoryType: 'EXISTING',
      });

      await prepareAndRun(token, projectId);

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.errorCode).toBe('workspace_invalid');
    });
  });

  describe('repository configuration protection', () => {
    it('blocks changing repository configuration while a workspace is prepared', async () => {
      const token = await registerUser('ws-repo-protect');
      const projectId = await buildFullyApprovedProject(token);
      await prepareAndRun(token, projectId);

      await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          repositoryType: 'EXISTING',
          repositoryUrl: 'https://example.com/org/repo.git',
        })
        .expect(409);

      // Unrelated fields may still be edited freely.
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed Project' })
        .expect(200);
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('ws-iso-owner');
      otherToken = await registerUser('ws-iso-other');
      projectId = await buildFullyApprovedProject(ownerToken);
    });

    it('hides the workspace from a non-owner behind a 404', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/workspace/prepare`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('leaves the workspace visible and manageable to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  it('Z: never invokes the AI provider for any workspace operation', async () => {
    const token = await registerUser('ws-no-ai');
    const projectId = await buildFullyApprovedProject(token);
    generateStructuredOutput.mockClear();

    await prepareAndRun(token, projectId);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/workspace`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });
});
