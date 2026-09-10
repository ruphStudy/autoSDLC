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
import { CODING_AGENT_PROVIDER } from '../src/coding-agent/coding-agent.constants';
import { CodingAgentProvider } from '../src/coding-agent/contracts/coding-agent-provider.interface';
import { CodingAgentExecutionRequest } from '../src/coding-agent/contracts/coding-agent-request';
import { CodingAgentExecutionResult } from '../src/coding-agent/contracts/coding-agent-result';

jest.setTimeout(60000);

function analysisResult() {
  return {
    data: {
      summary: 'A simple task app.',
      targetUsers: [],
      goals: [],
      features: [],
      functionalRequirements: [
        {
          id: 'FR-001',
          title: 'Foundations requirement',
          description: 'x',
          priority: 'must_have',
        },
        {
          id: 'FR-002',
          title: 'Auth requirement',
          description: 'x',
          priority: 'must_have',
        },
      ],
      nonFunctionalRequirements: [],
      assumptions: [],
      risks: [
        {
          risk: 'Vendor lock-in',
          severity: 'medium',
          mitigation: 'Abstract provider.',
        },
      ],
      unresolvedQuestions: [],
      integrations: [],
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.PROJECT_ANALYSIS,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-analysis-1',
    },
  };
}

function architectureResult() {
  return {
    data: {
      summary: 'Modular monolith.',
      frontendArchitecture: {},
      backendArchitecture: {},
      apiArchitecture: {},
      databaseArchitecture: {},
      authenticationArchitecture: {},
      integrationArchitecture: [],
      infrastructureArchitecture: {},
      deploymentArchitecture: {},
      securityArchitecture: {},
      testingStrategy: {
        unitTesting: { approach: 'Node scripts', tools: [] },
        integrationTesting: { approach: 'None', tools: [] },
        e2eTesting: { approach: 'None', tools: [] },
        validationCommands: [],
      },
      nonFunctionalDecisions: [],
      architectureDecisions: [
        {
          id: 'ADR-001',
          title: 'Use Postgres',
          context: 'Need a relational store.',
          decision: 'Use Postgres with Prisma.',
          rationale: 'Team familiarity.',
          alternativesConsidered: [],
          consequences: [],
        },
      ],
      requirementTraceability: [
        {
          requirementId: 'FR-001',
          architectureAreas: ['Backend Architecture'],
        },
        {
          requirementId: 'FR-002',
          architectureAreas: ['Authentication Architecture'],
        },
      ],
      unresolvedQuestions: [],
      constraints: [],
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.ARCHITECTURE_GENERATION,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-architecture-1',
    },
  };
}

function twoSprintPlanContent() {
  return {
    summary: 'Two sequential sprints.',
    strategy: 'Ship foundations, then auth.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Add file A.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Add file A',
            description: 'Create file-a.txt.',
            dependencies: [],
            acceptanceCriteria: ['file-a.txt exists.'],
            validationExpectations: [
              { type: 'lint', description: 'Lint the code', required: true },
            ],
            requirementIds: ['FR-001'],
            architectureAreas: ['Backend Architecture'],
          },
        ],
      },
      {
        number: 2,
        title: 'Authentication',
        objective: 'Add file B.',
        dependencies: [1],
        tasks: [
          {
            key: 'S2-T1',
            title: 'Add file B',
            description: 'Create file-b.txt.',
            dependencies: [],
            acceptanceCriteria: ['file-b.txt exists.'],
            validationExpectations: [
              { type: 'lint', description: 'Lint the code', required: true },
            ],
            requirementIds: ['FR-002'],
            architectureAreas: ['Authentication Architecture'],
          },
        ],
      },
    ],
  };
}

function sprintPlanResult() {
  return {
    data: twoSprintPlanContent(),
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.SPRINT_PLANNING,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-sprint-plan-1',
    },
  };
}

function taskInstructionResult(
  objective: string,
  acceptanceCriteria: string[],
) {
  return {
    data: {
      objective,
      repositoryObservations: ['Repository state observed.'],
      implementationPlan: [
        { step: 1, description: objective, likelyFiles: [] },
      ],
      constraints: [],
      acceptanceCriteria,
      validationPlan: [
        { type: 'lint', description: 'Lint the code', required: true },
      ],
      dependencyContext: [],
      risksOrWatchouts: [],
      requirementIds: [],
      finalInstruction: `TASK\n${objective}\n`,
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.TASK_INSTRUCTION,
      latencyMs: 1,
      attempts: 1,
      requestId: `req-task-instruction-${objective}`,
    },
  };
}

function acceptanceReviewResult() {
  return {
    data: {
      summary: 'Sprint delivered as planned.',
      objectiveAssessment: {
        satisfied: true,
        rationale: 'The Task satisfied the objective.',
      },
      requirementAssessment: { satisfied: true, gaps: [] },
      architectureAssessment: { aligned: true, concerns: [] },
      validationAssessment: { sufficient: true, concerns: [] },
      riskAssessment: { acceptable: true, concerns: [] },
      findings: [],
      recommendation: 'ACCEPT',
    },
    usage: { inputTokens: 30, outputTokens: 60, totalTokens: 90 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.SPRINT_REVIEW,
      latencyMs: 5,
      attempts: 1,
      requestId: 'req-sprint-review-1',
    },
  };
}

function agentSuccessResult(fileName: string): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: `${fileName} written.`,
    changedFiles: [{ path: fileName, changeType: 'ADDED' }],
    toolActivities: [{ type: 'tool_use', name: 'Write', summary: 'Write' }],
    commandActivities: [],
    usage: { inputTokens: 5, outputTokens: 15 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 10,
      turns: 1,
    },
  };
}

async function ensureNpmProject(
  workspacePath: string,
  scripts: Record<string, string>,
): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }, null, 2),
  );
  try {
    await fs.access(path.join(workspacePath, 'package-lock.json'));
  } catch {
    await fs.writeFile(path.join(workspacePath, 'package-lock.json'), '{}');
  }
}

describe('Sprint Acceptance & Review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobWorkerService;
  let workspaceRoot: string;
  const createdEmails: string[] = [];
  const generateStructuredOutput = jest.fn();
  const executeTask = jest.fn();
  const healthCheck = jest.fn();

  const stubPlanningProvider: PlanningAIProvider = {
    generateStructuredOutput,
    healthCheck: jest.fn(),
  };
  const stubCodingAgentProvider: CodingAgentProvider = {
    executeTask,
    healthCheck,
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
      .send({ name: 'Acceptance Demo', brief: 'Verify Sprint acceptance.' });
    return res.body.id as string;
  };

  // Builds a full two-Sprint plan (Sprint 2 depends on Sprint 1) through
  // real approvals + a real prepared Git workspace, and fully runs Sprint 1
  // to PASSED/COMPLETED through the real Sprint 12-14 orchestration
  // pipeline (only the AI planning provider and coding agent are mocked;
  // Git/npm/validation all run for real) — exactly item 143's desired
  // product flow, up to the point where an acceptance review can be
  // generated.
  const buildProjectWithSprint1Completed = async (
    token: string,
  ): Promise<{
    projectId: string;
    sprint1Id: string;
    sprint2Id: string;
    workspacePath: string;
  }> => {
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
    const planRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const sprint1Id = planRes.body.sprints[0].id as string;
    const sprint2Id = planRes.body.sprints[1].id as string;

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

    generateStructuredOutput.mockResolvedValue(
      taskInstructionResult('Add file-a.txt.', ['file-a.txt exists.']),
    );
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(0)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-a.txt'), 'content');
      return agentSuccessResult('file-a.txt');
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const sprintPlanRow = await prisma.sprintPlan.findFirstOrThrow({
      where: { projectId },
    });
    void sprintPlanRow;
    const workspacePath = path.join(workspaceRoot, projectId);
    return { projectId, sprint1Id, sprint2Id, workspacePath };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-sprint-acceptance-e2e-'),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubPlanningProvider)
      .overrideProvider(CODING_AGENT_PROVIDER)
      .useValue(stubCodingAgentProvider)
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
    executeTask.mockReset();
    healthCheck.mockReset();
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('rejects unauthenticated access to every acceptance route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/sprints/y/acceptance/generate')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/sprints/y/acceptance')
      .expect(401);
  });

  it('hides a foreign Sprint entirely (404, never 403)', async () => {
    const ownerToken = await registerUser('acceptance-owner');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(ownerToken);
    const otherToken = await registerUser('acceptance-other');
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('blocks generation for a Sprint that has not PASSED', async () => {
    const token = await registerUser('acceptance-not-passed');
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
    const planRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/projects/${projectId}/sprints/${planRes.body.sprints[0].id}/acceptance/generate`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('generates a review with deterministic evidence and a persisted AI recommendation, then can be Accepted', async () => {
    const token = await registerUser('acceptance-accept');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(token);

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(true);

    generateStructuredOutput.mockResolvedValue(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const current = await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.status).toBe('READY_FOR_DECISION');
    expect(current.body.version).toBe(1);
    expect(current.body.recommendation).toBe('ACCEPT');
    expect(current.body.deterministicSummary).toContain('1/1 Tasks passed');
    expect(current.body.requirementCoverage).toHaveLength(1);
    expect(current.body.requirementCoverage[0].requirementId).toBe('FR-001');
    expect(current.body.stale).toBe(false);

    const accepted = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Ship it.' })
      .expect(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(accepted.body.reviewedByUserId).toBeTruthy();

    const history = await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].status).toBe('ACCEPTED');
  });

  it('rejects a Sprint with a persisted reason', async () => {
    const token = await registerUser('acceptance-reject');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(token);

    generateStructuredOutput.mockResolvedValue(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const rejected = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Missing integration coverage for the login flow.' })
      .expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBe(
      'Missing integration coverage for the login flow.',
    );
  });

  it('never leaks a raw planning-provider error when the AI review fails, but still reaches READY_FOR_DECISION', async () => {
    const token = await registerUser('acceptance-ai-fail');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(token);

    generateStructuredOutput.mockRejectedValue(
      new Error('raw upstream 500 from a vendor SDK'),
    );
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const current = await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.status).toBe('READY_FOR_DECISION');
    expect(current.body.aiReviewStatus).toBe('FAILED');
    expect(current.body.deterministicSummary).toContain('Tasks passed');
    expect(JSON.stringify(current.body)).not.toContain('raw upstream 500');

    // Deterministic evidence alone is enough to make a manual decision
    // (item 35) even though AI review failed.
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });

  it('regenerating after a decision creates a new version and preserves the old one', async () => {
    const token = await registerUser('acceptance-regenerate');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(token);

    generateStructuredOutput.mockResolvedValue(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Needs another look.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/regenerate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const history = await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.map((h: { version: number }) => h.version)).toEqual([
      2, 1,
    ]);
    expect(history.body[1].status).toBe('REJECTED');
  });

  it('blocks mutation on an archived project but still allows a historical view', async () => {
    const token = await registerUser('acceptance-archived');
    const { projectId, sprint1Id } =
      await buildProjectWithSprint1Completed(token);
    generateStructuredOutput.mockResolvedValue(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/sprints/${sprint1Id}/acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('blocks the dependent Sprint from starting until the prerequisite Sprint is ACCEPTED (item 142)', async () => {
    const token = await registerUser('acceptance-gate');
    const { projectId, sprint1Id, sprint2Id } =
      await buildProjectWithSprint1Completed(token);

    // Sprint 1 mechanically PASSED but not yet accepted -> Sprint 2 blocked.
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint2Id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    generateStructuredOutput.mockResolvedValueOnce(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Now ACCEPTED -> Sprint 2 becomes eligible and can start for real.
    generateStructuredOutput.mockResolvedValue(
      taskInstructionResult('Add file-b.txt.', ['file-b.txt exists.']),
    );
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(0)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-b.txt'), 'content');
      return agentSuccessResult('file-b.txt');
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint2Id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
  });
});
