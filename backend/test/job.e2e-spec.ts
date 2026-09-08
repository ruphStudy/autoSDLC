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

function validAnalysisContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
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
    ...overrides,
  };
}

function analysisResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: validAnalysisContent(overrides),
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

function validArchitectureContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
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
    ...overrides,
  };
}

function architectureResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: validArchitectureContent(overrides),
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

function validationExpectation(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    type: 'unit_test',
    description: 'Unit tests pass.',
    required: true,
    ...overrides,
  };
}

function validSprintPlanContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
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
            validationExpectations: [validationExpectation()],
            requirementIds: ['FR-001'],
            architectureAreas: ['backendArchitecture'],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function sprintPlanResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: validSprintPlanContent(overrides),
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

describe('Jobs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobWorkerService;
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

  const createProject = async (token: string) => {
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Interview Prep Platform',
        brief: 'Build a mock interview platform.',
      });
    return res.body.id as string;
  };

  const buildFullyApprovedProject = async (token: string): Promise<string> => {
    const projectId = await createProject(token);

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

    return projectId;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubProvider)
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
  });

  it('rejects unauthenticated access to every job route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/jobs')
      .send({ type: 'PROJECT_PREPARATION' })
      .expect(401);
    await request(app.getHttpServer()).get('/projects/x/jobs').expect(401);
    await request(app.getHttpServer()).get('/projects/x/jobs/y').expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/jobs/y/cancel')
      .expect(401);
  });

  it('rejects a job type outside the public whitelist', async () => {
    const token = await registerUser('job-bad-type');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SYSTEM_TEST' })
      .expect(400);
  });

  it('blocks enqueueing PROJECT_PREPARATION before Start Development is approved', async () => {
    const token = await registerUser('job-not-approved');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'PROJECT_PREPARATION' })
      .expect(409);
  });

  describe('full lifecycle for an approved project', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('job-lifecycle');
      projectId = await buildFullyApprovedProject(token);
    });

    it('enqueues a PROJECT_PREPARATION job in QUEUED status', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'PROJECT_PREPARATION' })
        .expect(201);

      expect(res.body.status).toBe('QUEUED');
      expect(res.body.type).toBe('PROJECT_PREPARATION');
      expect(res.body).not.toHaveProperty('lockedBy');
    });

    it('lists jobs for the project, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('runs to SUCCEEDED and reports a safe project summary result', async () => {
      const enqueueRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'PROJECT_PREPARATION' })
        .expect(201);
      const jobId = enqueueRes.body.id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('SUCCEEDED');
      expect(detail.body.progress).toBe(100);
      expect(detail.body.result).toMatchObject({
        projectId,
        sprintPlanVersion: 1,
        sprintCount: 1,
        taskCount: 1,
      });

      const events = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${jobId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(events.body.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(['CREATED', 'CLAIMED', 'SUCCEEDED']),
      );
    });

    it('returns 404 for a job that does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/does-not-exist`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('cancels a QUEUED job via the API', async () => {
      const enqueueRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'PROJECT_PREPARATION' })
        .expect(201);
      const jobId = enqueueRes.body.id as string;

      const cancelRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs/${jobId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      // A cancelled job is never claimed/executed even if the worker runs.
      await worker.runOnce();
      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('CANCELLED');
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;
    let jobId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('job-iso-owner');
      otherToken = await registerUser('job-iso-other');
      projectId = await buildFullyApprovedProject(ownerToken);

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ type: 'PROJECT_PREPARATION' })
        .expect(201);
      jobId = res.body.id as string;
    });

    it('prevents another user from enqueueing a job for the project', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ type: 'PROJECT_PREPARATION' })
        .expect(404);
    });

    it('prevents another user from listing jobs', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from viewing job detail', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${jobId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from cancelling the job', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs/${jobId}/cancel`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('leaves the job visible and intact to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${jobId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  it('Z: never invokes the AI provider for any job operation', async () => {
    const token = await registerUser('job-no-ai');
    const projectId = await buildFullyApprovedProject(token);
    generateStructuredOutput.mockClear();

    const enqueueRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'PROJECT_PREPARATION' })
      .expect(201);
    await worker.runOnce();
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/jobs/${enqueueRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });
});
