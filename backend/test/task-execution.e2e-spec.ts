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
import { CodingAgentExecutionResult } from '../src/coding-agent/contracts/coding-agent-result';

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

// Two tasks in one sprint: S1-T2 depends on S1-T1 — used to exercise the
// "dependency must be exactly PASSED" gate.
function twoTaskSprintPlanContent() {
  return {
    summary: 'Deliver the interview flow.',
    strategy: 'Build the session model, then the start flow.',
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
            description: 'Implement the session entity.',
            dependencies: [],
            acceptanceCriteria: ['A session entity exists.'],
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
          {
            key: 'S1-T2',
            title: 'Add the start-interview endpoint',
            description: 'Implement the endpoint that starts a session.',
            dependencies: ['S1-T1'],
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
    data: twoTaskSprintPlanContent(),
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
    objective: 'Implement the interview session entity.',
    repositoryObservations: ['This is a freshly initialized repository.'],
    implementationPlan: [
      {
        step: 1,
        description: 'Add the InterviewSession entity.',
        likelyFiles: ['src/interviews/interview-session.entity.ts'],
      },
    ],
    constraints: ['Do not modify unrelated modules.'],
    acceptanceCriteria: ['A session entity exists.'],
    validationPlan: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    dependencyContext: [],
    risksOrWatchouts: [],
    requirementIds: ['FR-001'],
    finalInstruction:
      'TASK\nImplement the interview session entity.\n\nACCEPTANCE CRITERIA\n- A session entity exists.\n',
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

function successResult(
  overrides: Partial<CodingAgentExecutionResult> = {},
): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: 'Implemented the interview session entity.',
    changedFiles: [],
    toolActivities: [
      { type: 'tool_use', name: 'Write', summary: 'Write: hello.txt' },
    ],
    commandActivities: [],
    usage: { inputTokens: 200, outputTokens: 80 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 500,
      turns: 3,
      providerRequestId: 'sess-1',
    },
    ...overrides,
  };
}

// Each test here drives several sequential HTTP round-trips (analysis ->
// architecture -> a two-Task sprint plan -> approvals -> workspace prepare
// -> run), which comfortably fits the default 5s Jest timeout in isolation
// but can exceed it when the full e2e battery runs many Nest apps
// concurrently against the same local Postgres instance.
jest.setTimeout(20000);

describe('Task Execution / Single Task Orchestrator (e2e)', () => {
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
      .send({
        name: 'Task Execution Demo',
        brief: 'Verify the Single Task Orchestrator.',
      });
    return res.body.id as string;
  };

  const approveThroughStartDevelopment = async (
    token: string,
    projectId: string,
  ): Promise<{ taskId1: string; taskId2: string }> => {
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
    const taskId1 = sprintPlanRes.body.sprints[0].tasks[0].id as string;
    const taskId2 = sprintPlanRes.body.sprints[0].tasks[1].id as string;

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

    return { taskId1, taskId2 };
  };

  const buildReadyProject = async (
    token: string,
  ): Promise<{ projectId: string; taskId1: string; taskId2: string }> => {
    const projectId = await createProject(token);
    const { taskId1, taskId2 } = await approveThroughStartDevelopment(
      token,
      projectId,
    );
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    return { projectId, taskId1, taskId2 };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-task-execution-e2e-'),
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

  it('rejects unauthenticated access to every task-execution route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/tasks/y/run')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/execution-eligibility')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/executions')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/execution/current')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/task-executions/z')
      .expect(401);
  });

  it('reports a runnable eligibility for a fresh, dependency-free Task', async () => {
    const token = await registerUser('exec-eligible');
    const { projectId, taskId1 } = await buildReadyProject(token);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks/${taskId1}/execution-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.runnable).toBe(true);
    expect(res.body.reasons).toEqual([]);
  });

  it('blocks running a Task whose dependency has not PASSED yet', async () => {
    const token = await registerUser('exec-dependency');
    const { projectId, taskId2 } = await buildReadyProject(token);

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks/${taskId2}/execution-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.runnable).toBe(false);
    expect(eligibility.body.reasons).toContain('DEPENDENCY_NOT_PASSED');

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId2}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('returns 404 for a Task that does not belong to the project', async () => {
    const token = await registerUser('exec-foreign-task');
    const { projectId } = await buildReadyProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/does-not-exist/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('blocks running before Start Development is approved', async () => {
    const token = await registerUser('exec-not-approved');
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
      .post(`/projects/${projectId}/tasks/${taskId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('blocks running before the workspace is prepared', async () => {
    const token = await registerUser('exec-no-workspace');
    const projectId = await createProject(token);
    const { taskId1 } = await approveThroughStartDevelopment(token, projectId);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId1}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('blocks running for an archived project', async () => {
    const token = await registerUser('exec-archived');
    const { projectId, taskId1 } = await buildReadyProject(token);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId1}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  describe('successful run against a real Git fixture', () => {
    it('runs the Task end to end: Project DEVELOPING, Sprint RUNNING, Task REVIEWING (never PASSED), and detects a real ADDED file', async () => {
      const token = await registerUser('exec-success');
      const { projectId, taskId1 } = await buildReadyProject(token);

      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());
      executeTask.mockImplementation(async (req: { workspacePath: string }) => {
        await fs.writeFile(path.join(req.workspacePath, 'hello.txt'), 'hello');
        return successResult();
      });

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      expect(runRes.body.task.status).toBe('RUNNING');
      const executionId = runRes.body.taskExecution.id as string;

      await worker.runOnce();

      const project = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(project.body.status).toBe('DEVELOPING');

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/task-executions/${executionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('READY_FOR_VALIDATION');
      expect(detail.body.changedFiles).toEqual(
        expect.arrayContaining([
          { path: 'hello.txt', changeType: 'UNTRACKED' },
        ]),
      );
      expect(detail.body.repositoryStartSha).toBeTruthy();
      expect(detail.body.repositoryEndSha).toBe(detail.body.repositoryStartSha);

      const taskInstructionSentToProvider =
        executeTask.mock.calls[0][0].instruction;
      expect(taskInstructionSentToProvider).toContain(
        'interview session entity',
      );

      // Never PASSED — only Sprint 13's validation step can do that.
      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const task = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskId1,
      );
      expect(task.status).toBe('REVIEWING');
      expect(plan.body.sprints[0].status).toBe('RUNNING');
    });

    it('rejects a duplicate run while one is already active for the Task', async () => {
      const token = await registerUser('exec-duplicate');
      const { projectId, taskId1 } = await buildReadyProject(token);
      executeTask.mockResolvedValue(successResult());
      generateStructuredOutput.mockResolvedValue(taskInstructionResult());

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);

      // Still QUEUED — the worker has not run yet.
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await worker.runOnce();
    });

    it('cannot be rerun once the Task has reached REVIEWING', async () => {
      const token = await registerUser('exec-rerun-reviewing');
      const { projectId, taskId1 } = await buildReadyProject(token);
      executeTask.mockResolvedValue(successResult());
      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();

      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(res.body.message).toContain('TASK_REVIEWING');
    });
  });

  describe('failure path against a real Git fixture — no reset, no auto-retry', () => {
    it('marks the Task FAILED, preserves the dirty workspace as evidence, and blocks the next run', async () => {
      const token = await registerUser('exec-failure');
      const { projectId, taskId1 } = await buildReadyProject(token);

      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());
      executeTask.mockImplementation(async (req: { workspacePath: string }) => {
        await fs.writeFile(path.join(req.workspacePath, 'broken.txt'), 'oops');
        return {
          status: 'FAILED',
          summary: 'Execution ended without success.',
          errorCode: 'PROVIDER_UNAVAILABLE',
          errorMessage: 'Claude execution ended with an error.',
          changedFiles: [],
          toolActivities: [],
          commandActivities: [],
          metadata: { provider: 'claude', durationMs: 50 },
        } satisfies CodingAgentExecutionResult;
      });

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const executionId = runRes.body.taskExecution.id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/task-executions/${executionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('FAILED');
      expect(detail.body.changedFiles).toEqual(
        expect.arrayContaining([
          { path: 'broken.txt', changeType: 'UNTRACKED' },
        ]),
      );
      // Never a raw provider/SDK exception shape leaked to the client.
      expect(JSON.stringify(detail.body)).not.toMatch(
        /Anthropic|SDKMessage|ClaudeCode/,
      );

      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const task = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskId1,
      );
      expect(task.status).toBe('FAILED');

      // The workspace was never reset/cleaned — its dirty state now
      // naturally blocks any further execution for this project.
      const eligibility = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId1}/execution-eligibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(eligibility.body.reasons).toContain('WORKSPACE_DIRTY');

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('cancellation while queued', () => {
    it('cancels through the existing Sprint 8 job-cancel endpoint and self-heals the orphaned Task on the next eligibility check', async () => {
      const token = await registerUser('exec-cancel');
      const { projectId, taskId1 } = await buildReadyProject(token);

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const backgroundJobId = runRes.body.job.id as string;

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs/${backgroundJobId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await worker.runOnce();
      expect(executeTask).not.toHaveBeenCalled();

      const jobDetail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${backgroundJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(jobDetail.body.status).toBe('CANCELLED');

      // The Task orchestration handler never ran (the Job was cancelled
      // while still QUEUED), so the Task was left RUNNING — the next
      // eligibility check must self-heal it rather than block forever.
      const eligibility = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId1}/execution-eligibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(eligibility.body.runnable).toBe(true);

      generateStructuredOutput.mockResolvedValueOnce(taskInstructionResult());
      executeTask.mockResolvedValue(successResult());
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();
    });
  });

  describe('ownership isolation between users', () => {
    it('hides the project entirely from a non-owner (404, never 403)', async () => {
      const ownerToken = await registerUser('exec-iso-owner');
      const otherToken = await registerUser('exec-iso-other');
      const { projectId, taskId1 } = await buildReadyProject(ownerToken);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId1}/run`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId1}/execution-eligibility`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      expect(executeTask).not.toHaveBeenCalled();
    });
  });
});
