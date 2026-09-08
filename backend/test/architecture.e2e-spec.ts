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
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../src/ai/planning/errors/planning-ai.error';

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

describe('Architecture (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

  const createProjectWithAnalysis = async (token: string) => {
    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Interview Prep Platform',
        brief: 'Build a mock interview platform.',
      });
    const projectId = projectRes.body.id as string;

    generateStructuredOutput.mockResolvedValueOnce(analysisResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/analysis/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Architecture generation now requires an approved current analysis.
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/ANALYSIS`)
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

  it('rejects unauthenticated access to every architecture route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/architecture/generate')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/architecture')
      .expect(401);
  });

  it('rejects generation when no ProjectAnalysis exists yet', async () => {
    const token = await registerUser('arch-no-analysis');
    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Analysis Project', brief: 'x' });

    await request(app.getHttpServer())
      .post(`/projects/${projectRes.body.id}/architecture/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('rejects generation when the current Project Analysis exists but is not approved', async () => {
    const token = await registerUser('arch-unapproved-analysis');
    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Unapproved Analysis Project', brief: 'x' });
    const projectId = projectRes.body.id as string;

    generateStructuredOutput.mockResolvedValueOnce(analysisResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/analysis/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/architecture/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  describe('full lifecycle for the owning user', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('arch-owner');
      projectId = await createProjectWithAnalysis(token);
    });

    it('generates architecture v1 from the latest analysis', async () => {
      generateStructuredOutput.mockResolvedValueOnce(architectureResult());

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(1);
      expect(res.body.source).toBe('AI_GENERATED');
      expect(res.body.summary).toBe(validArchitectureContent().summary);
      expect(res.body.requirementTraceability).toEqual([
        { requirementId: 'FR-001', architectureAreas: ['backendArchitecture'] },
      ]);

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('ARCHITECTURE_READY');
    });

    it('rejects generating again while architecture already exists (use regenerate)', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('retrieves the current architecture', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.version).toBe(1);
    });

    it('edits the architecture, creating version 2 as USER_EDITED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .send({ summary: 'A manually refined architecture summary.' })
        .expect(200);

      expect(res.body.version).toBe(2);
      expect(res.body.source).toBe('USER_EDITED');
      expect(res.body.basedOnVersion).toBe(1);
      expect(res.body.backendArchitecture).toMatchObject(
        validArchitectureContent().backendArchitecture,
      );
    });

    it('rejects an edit that references an unknown functional requirement id', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          requirementTraceability: [
            {
              requirementId: 'FR-999',
              architectureAreas: ['backendArchitecture'],
            },
          ],
        })
        .expect(400);
    });

    it('regenerates, creating version 3 and preserving history', async () => {
      generateStructuredOutput.mockResolvedValueOnce(
        architectureResult({ summary: 'A freshly regenerated architecture.' }),
      );

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(3);
      expect(res.body.source).toBe('AI_GENERATED');
      expect(res.body.summary).toBe('A freshly regenerated architecture.');
    });

    it('lists version history, newest first, preserving every version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.map((v: { version: number }) => v.version)).toEqual([
        3, 2, 1,
      ]);
      expect(res.body.map((v: { source: string }) => v.source)).toEqual([
        'AI_GENERATED',
        'USER_EDITED',
        'AI_GENERATED',
      ]);
      expect(res.body[0].projectAnalysisId).toEqual(
        res.body[2].projectAnalysisId,
      );
    });

    it('retrieves a specific historical version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture/versions/1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.version).toBe(1);
      expect(res.body.source).toBe('AI_GENERATED');
    });

    it('returns 404 for a version that does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture/versions/99`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('provider failure handling', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('arch-failure');
      projectId = await createProjectWithAnalysis(token);
    });

    it('returns a safe normalized error and restores the project to ANALYSIS_APPROVED', async () => {
      generateStructuredOutput.mockRejectedValueOnce(
        new PlanningAIError({
          code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
          message:
            'raw internal provider detail that must never reach the client',
          provider: 'openai',
          retryable: true,
        }),
      );

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
      expect(JSON.stringify(res.body)).not.toContain(
        'raw internal provider detail',
      );

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('ANALYSIS_APPROVED');

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('allows a subsequent successful retry after a failed generation', async () => {
      generateStructuredOutput.mockResolvedValueOnce(architectureResult());

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    });

    it('preserves the existing architecture when a regeneration attempt fails', async () => {
      generateStructuredOutput.mockRejectedValueOnce(
        new PlanningAIError({
          code: PlanningErrorCode.TIMEOUT,
          message: 'timed out',
          provider: 'openai',
          retryable: true,
        }),
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(504);

      const current = await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(current.body.version).toBe(1);

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('ARCHITECTURE_READY');
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('arch-iso-owner');
      otherToken = await registerUser('arch-iso-other');
      projectId = await createProjectWithAnalysis(ownerToken);

      generateStructuredOutput.mockResolvedValueOnce(architectureResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
    });

    it('prevents another user from generating architecture for the project', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/regenerate`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from viewing the architecture', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from viewing the version history', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture/versions`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from editing the architecture', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ summary: 'Hijacked' })
        .expect(404);
    });

    it('leaves the architecture intact and visible to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('archived project policy', () => {
    it('blocks generation, regeneration, and edit for an archived project but allows viewing', async () => {
      const token = await registerUser('arch-archived');
      const projectId = await createProjectWithAnalysis(token);

      generateStructuredOutput.mockResolvedValueOnce(architectureResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .send({ summary: 'x' })
        .expect(409);

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/architecture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
