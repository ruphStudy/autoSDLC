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
import { GitService } from '../src/workspace/git/git.service';

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

function taskInstructionContent(overrides: Record<string, unknown> = {}) {
  return {
    objective: 'Implement the interview session entity and start endpoint.',
    repositoryObservations: ['This is a freshly initialized repository.'],
    implementationPlan: [
      {
        step: 1,
        description: 'Add the InterviewSession entity.',
        likelyFiles: ['src/interviews/interview-session.entity.ts'],
      },
    ],
    constraints: ['Do not modify unrelated modules.'],
    acceptanceCriteria: ['A session can be started.'],
    validationPlan: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    dependencyContext: [],
    risksOrWatchouts: [],
    requirementIds: ['FR-001'],
    finalInstruction:
      'TASK\nImplement the interview session entity and start endpoint.\n\nACCEPTANCE CRITERIA\n- A session can be started.\n',
    ...overrides,
  };
}

function taskInstructionResult(overrides: Record<string, unknown> = {}) {
  return {
    data: taskInstructionContent(overrides),
    usage: { inputTokens: 1200, outputTokens: 400, totalTokens: 1600 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.TASK_INSTRUCTION,
      latencyMs: 900,
      attempts: 1,
      requestId: 'req-task-instruction-1',
    },
  };
}

describe('Task Instruction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobWorkerService;
  let git: GitService;
  let workspaceRoot: string;
  const createdEmails: string[] = [];
  const generateStructuredOutput = jest.fn();

  const stubPlanningProvider: PlanningAIProvider = {
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
        name: 'Task Instruction Demo',
        brief: 'Verify Task instruction generation.',
      });
    return res.body.id as string;
  };

  // Builds a project through START_DEVELOPMENT approval, prepares a real
  // workspace, and returns the one Task's id from the fixture sprint plan.
  const buildReadyProjectWithTask = async (
    token: string,
  ): Promise<{ projectId: string; taskId: string }> => {
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
    const sprintPlanRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const taskId = sprintPlanRes.body.sprints[0].tasks[0].id as string;

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

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    return { projectId, taskId };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-task-instruction-e2e-'),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubPlanningProvider)
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
    git = moduleFixture.get(GitService);
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

  it('rejects unauthenticated access to every task-instruction route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/tasks/y/instruction/generate')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/instruction')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/instruction/versions')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/instruction/versions/1')
      .expect(401);
  });

  it('blocks generation before Start Development is approved', async () => {
    const token = await registerUser('ti-not-approved');
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
    const sprintPlanRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const taskId = sprintPlanRes.body.sprints[0].tasks[0].id as string;
    // Note: SPRINT_PLAN and START_DEVELOPMENT are deliberately left unapproved.

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(generateStructuredOutput).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: PlanningOperation.TASK_INSTRUCTION,
      }),
    );
  });

  it('blocks generation before the workspace is prepared', async () => {
    const token = await registerUser('ti-no-workspace');
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
    const sprintPlanRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const taskId = sprintPlanRes.body.sprints[0].tasks[0].id as string;
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

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  describe('full lifecycle against a READY workspace', () => {
    let token: string;
    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      token = await registerUser('ti-lifecycle');
      ({ projectId, taskId } = await buildReadyProjectWithTask(token));
    });

    it('generates version 1 grounded in the real repository HEAD', async () => {
      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(1);
      expect(res.body.taskId).toBe(taskId);
      expect(res.body.acceptanceCriteria).toEqual([
        'A session can be started.',
      ]);
      expect(res.body.repositoryHeadSha).toMatch(/^[0-9a-f]{40}$/);
      expect(res.body.stale).toBe(false);
      expect(res.body.finalInstruction).toContain(
        'Implement the interview session entity',
      );

      const sentRequest = generateStructuredOutput.mock.calls[0][0];
      expect(sentRequest.operation).toBe(PlanningOperation.TASK_INSTRUCTION);
      expect(sentRequest.userPrompt).not.toMatch(/claude|anthropic/i);
    });

    it('retrieves the current instruction and reports it as not stale', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.version).toBe(1);
      expect(res.body.stale).toBe(false);
    });

    it('reports the instruction as stale once the repository HEAD moves on', async () => {
      const workspacePath = path.join(workspaceRoot, projectId);
      await fs.writeFile(path.join(workspacePath, 'new-file.txt'), 'x');
      await git.stageFiles(workspacePath, ['new-file.txt']);
      await git.commit(workspacePath, 'chore: unrelated commit');

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.stale).toBe(true);
    });

    it('regenerates a new version reflecting the new HEAD, preserving version 1', async () => {
      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.version).toBe(2);
      expect(res.body.stale).toBe(false);

      const history = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(history.body.map((h: { version: number }) => h.version)).toEqual([
        2, 1,
      ]);

      const v1 = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction/versions/1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(v1.body.version).toBe(1);
      expect(v1.body.stale).toBe(true); // v1's captured HEAD is no longer live HEAD
    });

    it('rejects generation while the workspace has uncommitted changes', async () => {
      const workspacePath = path.join(workspaceRoot, projectId);
      await fs.writeFile(
        path.join(workspacePath, 'dirty.txt'),
        'not committed',
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await fs.rm(path.join(workspacePath, 'dirty.txt'));
    });

    it('never leaks a raw planning-provider error to the client', async () => {
      generateStructuredOutput.mockRejectedValueOnce(
        new Error('raw OpenAI SDK failure with internal detail'),
      );

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toContain('raw OpenAI SDK failure');
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('ti-iso-owner');
      otherToken = await registerUser('ti-iso-other');
      ({ projectId, taskId } = await buildReadyProjectWithTask(ownerToken));
      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
    });

    it('hides the project entirely from a non-owner (404, never 403)', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns 404 for a foreign taskId even under the owner-authenticated project', async () => {
      const other = await createProject(otherToken);
      await request(app.getHttpServer())
        .post(`/projects/${other}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('leaves the instruction visible to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/instruction`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('archived project protection', () => {
    it('blocks generation for an archived project', async () => {
      const token = await registerUser('ti-archived');
      const { projectId, taskId } = await buildReadyProjectWithTask(token);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/instruction/generate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });
});
