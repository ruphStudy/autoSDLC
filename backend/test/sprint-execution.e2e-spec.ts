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
          title: 'Do the thing',
          description: 'x',
          priority: 'must_have',
        },
      ],
      nonFunctionalRequirements: [],
      assumptions: [],
      risks: [],
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
      architectureDecisions: [],
      requirementTraceability: [],
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

const TASK_A_EXPECTATIONS = [
  { type: 'lint', description: 'Lint the code', required: true },
];
const TASK_B_EXPECTATIONS = [
  { type: 'lint', description: 'Lint the code', required: true },
];

function twoTaskSprintPlanContent() {
  return {
    summary: 'One sprint, two dependent Tasks.',
    strategy: 'Ship file A, then file B.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Add two files, one depending on the other.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Add file A',
            description: 'Create file-a.txt.',
            dependencies: [],
            acceptanceCriteria: ['file-a.txt exists.'],
            validationExpectations: TASK_A_EXPECTATIONS,
            requirementIds: ['FR-001'],
            architectureAreas: [],
          },
          {
            key: 'S1-T2',
            title: 'Add file B',
            description: 'Create file-b.txt, building on file A.',
            dependencies: ['S1-T1'],
            acceptanceCriteria: ['file-b.txt exists.'],
            validationExpectations: TASK_B_EXPECTATIONS,
            requirementIds: ['FR-001'],
            architectureAreas: [],
          },
        ],
      },
    ],
  };
}

function sprintPlanResult() {
  return {
    data: twoTaskSprintPlanContent(),
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
  validationExpectations: {
    type: string;
    description: string;
    required: boolean;
  }[],
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
      // Sprint 11's instruction-validator requires the Task's own
      // acceptance criteria to survive verbatim here.
      acceptanceCriteria,
      validationPlan: validationExpectations,
      dependencyContext: [],
      risksOrWatchouts: [],
      requirementIds: ['FR-001'],
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

function agentSuccessResult(): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: 'File written.',
    changedFiles: [],
    toolActivities: [{ type: 'tool_use', name: 'Write', summary: 'Write' }],
    commandActivities: [],
    usage: { inputTokens: 10, outputTokens: 10 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 20,
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

describe('Sprint Orchestrator / autonomous multi-Task execution (e2e)', () => {
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
        name: 'Sprint Orchestrator Demo',
        brief: 'Verify autonomous Sprint execution.',
      });
    return res.body.id as string;
  };

  const buildReadyProject = async (
    token: string,
  ): Promise<{
    projectId: string;
    sprintId: string;
    taskAId: string;
    taskBId: string;
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
    const sprintPlanRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const sprintId = sprintPlanRes.body.sprints[0].id as string;
    const taskAId = sprintPlanRes.body.sprints[0].tasks[0].id as string;
    const taskBId = sprintPlanRes.body.sprints[0].tasks[1].id as string;

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

    return { projectId, sprintId, taskAId, taskBId };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-sprint-execution-e2e-'),
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

  it('rejects unauthenticated access to every sprint-execution route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/sprints/y/run')
      .expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/sprints/y/pause')
      .expect(401);
    await request(app.getHttpServer())
      .post('/projects/x/sprints/y/resume')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/sprints/y/execution-eligibility')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/sprints/y/execution')
      .expect(401);
  });

  it('returns 404 for a Sprint that does not belong to the project', async () => {
    const token = await registerUser('sprintx-foreign');
    const { projectId } = await buildReadyProject(token);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/does-not-exist/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // Sprint 18 item 54/108: a "historical plan drives execution" scenario
  // turns out to be structurally unreachable in this codebase, not merely
  // untested — SprintPlanningService.regenerate()'s own allowedEntry list
  // (PLAN_READY/PLAN_APPROVED only) already refuses to create a superseding
  // plan version once development has been approved, so there is never a
  // point at which a "historical" plan and a runnable Sprint can coexist.
  // TaskExecutionService/SprintExecutionService's own
  // TASK_NOT_IN_CURRENT_PLAN/SPRINT_NOT_IN_CURRENT_PLAN checks (unit-tested
  // in their own spec files) remain as defense in depth for this
  // currently-unreachable case. This test asserts the actually-reachable
  // guarantee instead: regeneration itself is blocked post-approval.
  it('blocks regenerating the Sprint Plan once development has been approved', async () => {
    const token = await registerUser('sprintx-plan-locked');
    const { projectId } = await buildReadyProject(token);

    const blocked = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprint-plan/regenerate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(blocked.body.message).toContain('DEVELOPMENT_APPROVED');
  });

  describe('successful autonomous run against a real Git + npm fixture (two dependent Tasks)', () => {
    it('executes both Tasks strictly in dependency order, committing once per Task, and completes the Sprint', async () => {
      const token = await registerUser('sprintx-success');
      const { projectId, sprintId, taskAId, taskBId } =
        await buildReadyProject(token);

      generateStructuredOutput.mockImplementation(
        async (req: { metadata?: Record<string, string> }) => {
          const isTaskA = req.metadata?.taskId === taskAId;
          return taskInstructionResult(
            isTaskA ? TASK_A_EXPECTATIONS : TASK_B_EXPECTATIONS,
            isTaskA ? 'Add file-a.txt' : 'Add file-b.txt',
            [isTaskA ? 'file-a.txt exists.' : 'file-b.txt exists.'],
          );
        },
      );
      const writtenFiles: string[] = [];
      executeTask.mockImplementation(
        async (req: CodingAgentExecutionRequest) => {
          await ensureNpmProject(req.workspacePath, {
            lint: 'node -e "process.exit(0)"',
          });
          const fileName = req.taskId === taskAId ? 'file-a.txt' : 'file-b.txt';
          await fs.writeFile(path.join(req.workspacePath, fileName), 'content');
          writtenFiles.push(fileName);
          return agentSuccessResult();
        },
      );

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const executionId = runRes.body.sprintExecution.id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-executions/${executionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('COMPLETED');
      expect(detail.body.passedTasks).toBe(2);
      expect(detail.body.repositoryStartSha).toBeTruthy();
      expect(detail.body.repositoryEndSha).toBeTruthy();
      expect(detail.body.repositoryEndSha).not.toBe(
        detail.body.repositoryStartSha,
      );

      // Deterministic, dependency-respecting order: file A's Task must have
      // executed (and its file been written) strictly before file B's.
      expect(writtenFiles).toEqual(['file-a.txt', 'file-b.txt']);

      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(plan.body.sprints[0].status).toBe('PASSED');
      const taskA = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskAId,
      );
      const taskB = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskBId,
      );
      expect(taskA.status).toBe('PASSED');
      expect(taskB.status).toBe('PASSED');

      const workspaceStatus = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(workspaceStatus.body.clean).toBe(true);

      // Two real commits: one per passed Task, never squashed.
      const workspacePath = path.join(workspaceRoot, projectId);
      const { execFileSync } = await import('node:child_process');
      const log = execFileSync('git', ['log', '--oneline', '--format=%s'], {
        cwd: workspacePath,
      }).toString();
      expect(log).toContain('S1-T1');
      expect(log).toContain('S1-T2');
      expect(log.trim().split('\n')).toHaveLength(3); // 2 Task commits + the initial empty commit
    });

    it('rejects a duplicate run while the Sprint execution is already active', async () => {
      const token = await registerUser('sprintx-duplicate');
      const { projectId, sprintId, taskAId } = await buildReadyProject(token);
      generateStructuredOutput.mockResolvedValue(
        taskInstructionResult(TASK_A_EXPECTATIONS, 'Add file-a.txt', [
          'file-a.txt exists.',
        ]),
      );
      executeTask.mockImplementation(
        async (req: CodingAgentExecutionRequest) => {
          await ensureNpmProject(req.workspacePath, {
            lint: 'node -e "process.exit(0)"',
          });
          await fs.writeFile(
            path.join(req.workspacePath, 'file-a.txt'),
            'content',
          );
          return agentSuccessResult();
        },
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await worker.runOnce();
      void taskAId;
    });
  });

  describe('failure path — first Task commits, second Task fails validation, Sprint stops', () => {
    it('preserves the first Task commit, leaves the second Task dirty, and never leaves the Sprint looping', async () => {
      const token = await registerUser('sprintx-failure');
      const { projectId, sprintId, taskAId, taskBId } =
        await buildReadyProject(token);

      generateStructuredOutput.mockImplementation(
        async (req: { metadata?: Record<string, string> }) => {
          const isTaskA = req.metadata?.taskId === taskAId;
          return taskInstructionResult(
            isTaskA ? TASK_A_EXPECTATIONS : TASK_B_EXPECTATIONS,
            isTaskA ? 'Add file-a.txt' : 'Add file-b.txt',
            [isTaskA ? 'file-a.txt exists.' : 'file-b.txt exists.'],
          );
        },
      );
      executeTask.mockImplementation(
        async (req: CodingAgentExecutionRequest) => {
          if (req.taskId === taskAId) {
            await ensureNpmProject(req.workspacePath, {
              lint: 'node -e "process.exit(0)"',
            });
            await fs.writeFile(
              path.join(req.workspacePath, 'file-a.txt'),
              'content',
            );
          } else {
            // Task B's lint script is broken — its validation will fail.
            await ensureNpmProject(req.workspacePath, {
              lint: 'node -e "process.exit(1)"',
            });
            await fs.writeFile(
              path.join(req.workspacePath, 'file-b.txt'),
              'content',
            );
          }
          return agentSuccessResult();
        },
      );

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const executionId = runRes.body.sprintExecution.id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-executions/${executionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('FAILED');

      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(plan.body.sprints[0].status).toBe('FAILED');
      const taskA = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskAId,
      );
      const taskB = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskBId,
      );
      expect(taskA.status).toBe('PASSED');
      expect(taskB.status).toBe('FAILED');

      // Task A's commit survives; Task B's changes remain uncommitted.
      const workspacePath = path.join(workspaceRoot, projectId);
      const { execFileSync } = await import('node:child_process');
      const log = execFileSync('git', ['log', '--oneline', '--format=%s'], {
        cwd: workspacePath,
      }).toString();
      expect(log).toContain('S1-T1');
      expect(log).not.toContain('S1-T2');

      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: workspacePath,
      }).toString();
      expect(status).toContain('file-b.txt');

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  // Sprint 18 item 47: pause takes effect only at a Task boundary — the
  // in-flight Task must finish normally, the NEXT Task must not start, and
  // resume must let the Sprint carry on to completion.
  describe('pause and resume', () => {
    it('finishes the in-flight Task, holds the next Task until resume, then completes the Sprint', async () => {
      const token = await registerUser('sprintx-pause');
      const { projectId, sprintId, taskAId, taskBId } =
        await buildReadyProject(token);

      generateStructuredOutput.mockImplementation(
        async (req: { metadata?: Record<string, string> }) => {
          const isTaskA = req.metadata?.taskId === taskAId;
          return taskInstructionResult(
            isTaskA ? TASK_A_EXPECTATIONS : TASK_B_EXPECTATIONS,
            isTaskA ? 'Add file-a.txt' : 'Add file-b.txt',
            [isTaskA ? 'file-a.txt exists.' : 'file-b.txt exists.'],
          );
        },
      );
      executeTask.mockImplementation(
        async (req: CodingAgentExecutionRequest) => {
          await ensureNpmProject(req.workspacePath, {
            lint: 'node -e "process.exit(0)"',
          });
          if (req.taskId === taskAId) {
            // Simulate a user clicking Pause while Task A is still running —
            // the real pause HTTP endpoint, called mid-flight, exactly as a
            // browser tab open on the Development dashboard would.
            await request(app.getHttpServer())
              .post(`/projects/${projectId}/sprints/${sprintId}/pause`)
              .set('Authorization', `Bearer ${token}`)
              .expect(200);
            await fs.writeFile(
              path.join(req.workspacePath, 'file-a.txt'),
              'content',
            );
          } else {
            await fs.writeFile(
              path.join(req.workspacePath, 'file-b.txt'),
              'content',
            );
          }
          return agentSuccessResult();
        },
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();

      const afterPause = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprints/${sprintId}/execution`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterPause.body.status).toBe('PAUSED');
      expect(afterPause.body.passedTasks).toBe(1);

      const planAfterPause = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const taskAAfterPause = planAfterPause.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskAId,
      );
      const taskBAfterPause = planAfterPause.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskBId,
      );
      expect(taskAAfterPause.status).toBe('PASSED');
      expect(taskBAfterPause.status).not.toBe('PASSED');
      expect(taskBAfterPause.status).not.toBe('RUNNING');

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/resume`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();

      const afterResume = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprints/${sprintId}/execution`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterResume.body.status).toBe('COMPLETED');
      expect(afterResume.body.passedTasks).toBe(2);
    });
  });

  describe('cancellation while queued', () => {
    it('cancels through the existing Sprint 8 job-cancel endpoint and self-heals on the next eligibility check', async () => {
      const token = await registerUser('sprintx-cancel');
      const { projectId, sprintId } = await buildReadyProject(token);

      const runRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
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

      const eligibility = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprints/${sprintId}/execution-eligibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(eligibility.body.runnable).toBe(true);
    });
  });

  describe('ownership isolation between users', () => {
    it('hides the project entirely from a non-owner (404, never 403)', async () => {
      const ownerToken = await registerUser('sprintx-iso-owner');
      const otherToken = await registerUser('sprintx-iso-other');
      const { projectId, sprintId } = await buildReadyProject(ownerToken);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      expect(executeTask).not.toHaveBeenCalled();
    });
  });

  describe('archived project protection', () => {
    it('blocks running the Sprint for an archived project', async () => {
      const token = await registerUser('sprintx-archived');
      const { projectId, sprintId } = await buildReadyProject(token);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/sprints/${sprintId}/run`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });
});
