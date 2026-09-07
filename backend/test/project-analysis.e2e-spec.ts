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

function successResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: validAnalysisContent(overrides),
    usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.PROJECT_ANALYSIS,
      latencyMs: 42,
      attempts: 1,
      requestId: 'req-e2e-1',
    },
  };
}

describe('Project Analysis (e2e)', () => {
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
    generateStructuredOutput.mockResolvedValue(successResult());
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  it('rejects unauthenticated access to every analysis route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/analysis/generate')
      .expect(401);
    await request(app.getHttpServer()).get('/projects/x/analysis').expect(401);
  });

  describe('full lifecycle for the owning user', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('analysis-owner');
      projectId = await createProject(token);
    });

    it('generates the initial analysis (v1) and moves the project to ANALYSIS_READY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(1);
      expect(res.body.source).toBe('AI_GENERATED');
      expect(res.body.summary).toBe('A mock interview platform.');
      expect(generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: PlanningOperation.PROJECT_ANALYSIS,
        }),
      );

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('ANALYSIS_READY');
    });

    it('rejects generating again while already ANALYSIS_READY (wrong-state / concurrent generation)', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('retrieves the current analysis', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.version).toBe(1);
    });

    it('edits the analysis, creating version 2 as USER_EDITED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .send({ summary: 'A manually refined mock interview platform.' })
        .expect(200);

      expect(res.body.version).toBe(2);
      expect(res.body.source).toBe('USER_EDITED');
      expect(res.body.basedOnVersion).toBe(1);
      // Untouched sections survive the edit.
      expect(res.body.features).toEqual(validAnalysisContent().features);

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('ANALYSIS_READY');
    });

    it('rejects an edit payload that fails schema validation', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .send({ features: [{ name: 'Missing required fields' }] })
        .expect(400);
    });

    it('regenerates, creating version 3 and preserving history', async () => {
      generateStructuredOutput.mockResolvedValue(
        successResult({ summary: 'A freshly regenerated analysis.' }),
      );

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(3);
      expect(res.body.source).toBe('AI_GENERATED');
      expect(res.body.summary).toBe('A freshly regenerated analysis.');
    });

    it('lists version history, newest first, preserving every version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis/versions`)
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
    });

    it('retrieves a specific historical version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis/versions/1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.version).toBe(1);
      expect(res.body.source).toBe('AI_GENERATED');
    });

    it('returns 404 for a version that does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis/versions/99`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('provider failure handling', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('analysis-failure');
      projectId = await createProject(token);
    });

    it('returns a safe normalized error and restores the project to DRAFT', async () => {
      generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
          message:
            'raw internal provider detail that must never reach the client',
          provider: 'openai',
          retryable: true,
        }),
      );

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
      expect(JSON.stringify(res.body)).not.toContain(
        'raw internal provider detail',
      );

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('DRAFT');

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('allows a subsequent successful retry after a failed generation', async () => {
      generateStructuredOutput.mockResolvedValue(successResult());

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    });
  });

  describe('a project with no analysis yet', () => {
    it('returns 404 for the current-analysis lookup', async () => {
      const token = await registerUser('analysis-none');
      const projectId = await createProject(token);

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('analysis-iso-owner');
      otherToken = await registerUser('analysis-iso-other');
      projectId = await createProject(ownerToken);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
    });

    it('prevents another user from generating analysis for the project', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from viewing the analysis', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from viewing the version history', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis/versions`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from editing the analysis', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ summary: 'Hijacked' })
        .expect(404);
    });

    it('leaves the analysis intact and visible to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });
});
