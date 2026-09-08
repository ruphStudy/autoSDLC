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

describe('Approval workflow (e2e)', () => {
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

  const createProject = async (
    token: string,
    name = 'Interview Prep Platform',
  ) => {
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, brief: 'Build a mock interview platform.' });
    return res.body.id as string;
  };

  const generateAndApproveAnalysis = async (
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
  };

  const generateAndApproveArchitecture = async (
    token: string,
    projectId: string,
  ) => {
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
  };

  const generateAndApproveSprintPlan = async (
    token: string,
    projectId: string,
  ) => {
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
  };

  // Builds a project with all three artifacts generated AND approved —
  // the full prerequisite state for Start Development.
  const buildFullyApprovedProject = async (token: string) => {
    const projectId = await createProject(token);
    await generateAndApproveAnalysis(token, projectId);
    await generateAndApproveArchitecture(token, projectId);
    await generateAndApproveSprintPlan(token, projectId);
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

  it('rejects unauthenticated access to every approval route', async () => {
    await request(app.getHttpServer()).get('/projects/x/approvals').expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/approvals/ANALYSIS')
      .expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/approvals/ANALYSIS')
      .send({ decision: 'APPROVED' })
      .expect(401);
  });

  it('rejects an unknown approval stage', async () => {
    const token = await registerUser('appr-bad-stage');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/approvals/NOT_A_STAGE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(400);
  });

  describe('full lifecycle: A through I', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('appr-lifecycle');
      projectId = await createProject(token);
    });

    it('A: approves the current Analysis', async () => {
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.decision).toBe('APPROVED');
      expect(res.body.artifactVersion).toBe(1);
      expect(res.body.artifactType).toBe('PROJECT_ANALYSIS');
    });

    it('B: Architecture generation is blocked before Analysis approval (covered structurally — verified via a fresh project)', async () => {
      const freshToken = await registerUser('appr-b');
      const freshProjectId = await createProject(freshToken);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/analysis/generate`)
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/architecture/generate`)
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(409);
    });

    it('C: Architecture generation is allowed after Analysis approval', async () => {
      generateStructuredOutput.mockResolvedValueOnce(architectureResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    });

    it('D: approves the current Architecture', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ARCHITECTURE`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.decision).toBe('APPROVED');
      expect(res.body.artifactType).toBe('ARCHITECTURE');
    });

    it('E: Sprint Planning is blocked before Architecture approval (verified via a fresh project)', async () => {
      const freshToken = await registerUser('appr-e');
      const freshProjectId = await createProject(freshToken);
      await generateAndApproveAnalysis(freshToken, freshProjectId);
      generateStructuredOutput.mockResolvedValueOnce(architectureResult());
      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/architecture/generate`)
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/sprint-plan/generate`)
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(409);
    });

    it('F: Sprint Planning is allowed after Architecture approval', async () => {
      generateStructuredOutput.mockResolvedValueOnce(sprintPlanResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprint-plan/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    });

    it('G: approves the Sprint Plan', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/SPRINT_PLAN`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.decision).toBe('APPROVED');
      expect(res.body.artifactType).toBe('SPRINT_PLAN');

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('PLAN_APPROVED');
    });

    it('H: Start Development is blocked until a fresh unapproved project reaches the same point (covered separately below)', async () => {
      // A dedicated negative case lives in its own describe block below —
      // this project is already fully approved by this point in the
      // lifecycle, so blocking is exercised on a fresh partially-approved
      // project instead of this one.
      const freshToken = await registerUser('appr-h');
      const freshProjectId = await createProject(freshToken);
      await generateAndApproveAnalysis(freshToken, freshProjectId);
      await generateAndApproveArchitecture(freshToken, freshProjectId);
      // Sprint Plan generated but NOT approved.
      generateStructuredOutput.mockResolvedValueOnce(sprintPlanResult());
      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/sprint-plan/generate`)
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${freshProjectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${freshToken}`)
        .send({ decision: 'APPROVED' })
        .expect(409);
    });

    it('I: Start Development succeeds after all three are approved', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.decision).toBe('APPROVED');
      expect(res.body.artifactType).toBe('PROJECT');

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('DEVELOPMENT_APPROVED');
    });

    it('rejects CHANGES_REQUESTED for Start Development', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'CHANGES_REQUESTED', comment: 'x' })
        .expect(400);
    });
  });

  describe('J/K: regeneration creates a new unapproved version, old approval stays historical', () => {
    it('regenerated Analysis creates an unapproved v2 while v1 stays approved in history', async () => {
      const token = await registerUser('appr-jk-analysis');
      const projectId = await createProject(token);
      await generateAndApproveAnalysis(token, projectId);

      generateStructuredOutput.mockResolvedValueOnce(
        analysisResult({ summary: 'A regenerated summary.' }),
      );
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const current = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(current.body.currentVersion).toBe(2);
      expect(current.body.decision).toBeNull();

      const history = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals?stage=ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0]).toMatchObject({
        decision: 'APPROVED',
        artifactVersion: 1,
      });

      // Architecture generation is blocked again until v2 is approved.
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('L: regenerated Architecture invalidates the current approval', async () => {
      const token = await registerUser('appr-l');
      const projectId = await createProject(token);
      await generateAndApproveAnalysis(token, projectId);
      await generateAndApproveArchitecture(token, projectId);

      generateStructuredOutput.mockResolvedValueOnce(
        architectureResult({ summary: 'A regenerated architecture.' }),
      );
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const current = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/ARCHITECTURE`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(current.body.currentVersion).toBe(2);
      expect(current.body.decision).toBeNull();

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprint-plan/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('M: regenerated Sprint Plan invalidates the current approval', async () => {
      const token = await registerUser('appr-m');
      const projectId = await buildFullyApprovedProject(token);

      generateStructuredOutput.mockResolvedValueOnce(
        sprintPlanResult({ summary: 'A regenerated plan.' }),
      );
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprint-plan/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const current = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/SPRINT_PLAN`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(current.body.currentVersion).toBe(2);
      expect(current.body.decision).toBeNull();

      // Start Development is blocked again despite having been reachable
      // before this regeneration.
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(409);
    });
  });

  describe('N/O: CHANGES_REQUESTED', () => {
    it('stores the decision with its comment and never mutates the artifact', async () => {
      const token = await registerUser('appr-changes-requested');
      const projectId = await createProject(token);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const before = await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          decision: 'CHANGES_REQUESTED',
          comment: 'Authentication tasks need stronger acceptance criteria.',
        })
        .expect(200);

      expect(res.body.decision).toBe('CHANGES_REQUESTED');
      expect(res.body.comment).toBe(
        'Authentication tasks need stronger acceptance criteria.',
      );

      const after = await request(app.getHttpServer())
        .get(`/projects/${projectId}/analysis`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body).toEqual(before.body);

      // Architecture generation is still blocked — a rejection is not an approval.
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/architecture/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('requires a comment for CHANGES_REQUESTED', async () => {
      const token = await registerUser('appr-changes-no-comment');
      const projectId = await createProject(token);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'CHANGES_REQUESTED' })
        .expect(400);
    });
  });

  describe('P/Q: version scoping and history ordering', () => {
    it('P: approval actions always resolve to the current version server-side, never a client-supplied one', async () => {
      const token = await registerUser('appr-p');
      const projectId = await createProject(token);
      await generateAndApproveAnalysis(token, projectId);
      generateStructuredOutput.mockResolvedValueOnce(
        analysisResult({ summary: 'v2 summary' }),
      );
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // Even though the client sends no version at all (there is no such
      // field in the API), the decision always lands on v2, never v1.
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      expect(res.body.artifactVersion).toBe(2);
    });

    it('Q: approval history is ordered newest-first across multiple decisions on the same version', async () => {
      const token = await registerUser('appr-q');
      const projectId = await createProject(token);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          decision: 'CHANGES_REQUESTED',
          comment: 'First pass feedback.',
        })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          decision: 'CHANGES_REQUESTED',
          comment: 'Second pass feedback.',
        })
        .expect(200);

      const history = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals?stage=ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(history.body.map((r: { decision: string }) => r.decision)).toEqual(
        ['CHANGES_REQUESTED', 'APPROVED', 'CHANGES_REQUESTED'],
      );
    });
  });

  describe('R: idempotent repeated decisions', () => {
    it('a double-click / repeated identical approval does not create duplicate history rows', async () => {
      const token = await registerUser('appr-r');
      const projectId = await createProject(token);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const first = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);

      const history = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals?stage=ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(history.body).toHaveLength(1);
    });
  });

  describe('S: cross-project / cross-user isolation', () => {
    it('rejects another user from viewing or deciding approvals for a project they do not own', async () => {
      const ownerToken = await registerUser('appr-s-owner');
      const otherToken = await registerUser('appr-s-other');
      const projectId = await createProject(ownerToken);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ decision: 'APPROVED' })
        .expect(404);

      // The real owner is unaffected.
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
    });
  });

  describe('T/U: the future execution gate (approveStartDevelopment as its proxy)', () => {
    it('T: fails before every current artifact is approved', async () => {
      const token = await registerUser('appr-t');
      const projectId = await createProject(token);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(409);
    });

    it('U: succeeds once current Analysis, Architecture, and Sprint Plan are all approved', async () => {
      const token = await registerUser('appr-u');
      const projectId = await buildFullyApprovedProject(token);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
    });
  });

  describe('V: approval operations never call the AI provider', () => {
    it('records approvals and rejections without ever invoking generateStructuredOutput', async () => {
      const token = await registerUser('appr-v');
      const projectId = await createProject(token);
      generateStructuredOutput.mockResolvedValueOnce(analysisResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/analysis/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      generateStructuredOutput.mockClear();

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'CHANGES_REQUESTED', comment: 'x' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(generateStructuredOutput).not.toHaveBeenCalled();
    });
  });

  describe('approval summary', () => {
    it('exposes a compact per-stage summary without exposing internal ids', async () => {
      const token = await registerUser('appr-summary');
      const projectId = await buildFullyApprovedProject(token);

      const summary = await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals/summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(summary.body.analysis).toMatchObject({
        decision: 'APPROVED',
        version: 1,
      });
      expect(summary.body.architecture).toMatchObject({
        decision: 'APPROVED',
        version: 1,
      });
      expect(summary.body.sprintPlan).toMatchObject({
        decision: 'APPROVED',
        version: 1,
      });
      expect(summary.body.startDevelopment).toMatchObject({
        decision: null,
        version: null,
      });
    });
  });

  describe('cascade behavior', () => {
    it('deleting a project also deletes its approval history', async () => {
      const token = await registerUser('appr-cascade');
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

      expect(await prisma.approval.count({ where: { projectId } })).toBe(1);

      await request(app.getHttpServer())
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(await prisma.approval.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('archived project policy', () => {
    it('blocks approval decisions for an archived project but allows viewing history', async () => {
      const token = await registerUser('appr-archived');
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

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/approvals/ANALYSIS`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED' })
        .expect(409);

      await request(app.getHttpServer())
        .get(`/projects/${projectId}/approvals`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
