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

const TASK_EXPECTATIONS = [
  { type: 'lint', description: 'Lint the code', required: true },
];

function oneTaskSprintPlanContent() {
  return {
    summary: 'One sprint, one Task.',
    strategy: 'Ship file A.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Add a file.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Add file A',
            description: 'Create file-a.txt.',
            dependencies: [],
            acceptanceCriteria: ['file-a.txt exists.'],
            validationExpectations: TASK_EXPECTATIONS,
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
    data: oneTaskSprintPlanContent(),
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

function taskInstructionResult() {
  return {
    data: {
      objective: 'Add file-a.txt.',
      repositoryObservations: ['Repository state observed.'],
      implementationPlan: [
        { step: 1, description: 'Add file A.', likelyFiles: [] },
      ],
      constraints: [],
      acceptanceCriteria: ['file-a.txt exists.'],
      validationPlan: TASK_EXPECTATIONS,
      dependencyContext: [],
      risksOrWatchouts: [],
      requirementIds: ['FR-001'],
      finalInstruction: 'TASK\nAdd file-a.txt.\n',
    },
    usage: { inputTokens: 15, outputTokens: 25, totalTokens: 40 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.TASK_INSTRUCTION,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-task-instruction-1',
    },
  };
}

function agentSuccessResult(): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: 'File written.',
    changedFiles: [{ path: 'file-a.txt', changeType: 'ADDED' }],
    toolActivities: [{ type: 'tool_use', name: 'Write', summary: 'Write' }],
    commandActivities: [],
    usage: { inputTokens: 111, outputTokens: 222 },
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

describe('Execution Monitoring Dashboard (e2e)', () => {
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
      .send({ name: 'Monitor Demo', brief: 'Verify the execution monitor.' });
    return res.body.id as string;
  };

  const buildAnalyzedProject = async (token: string): Promise<string> => {
    const projectId = await createProject(token);
    generateStructuredOutput.mockResolvedValueOnce(analysisResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/analysis/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return projectId;
  };

  const buildReadyProject = async (
    token: string,
  ): Promise<{
    projectId: string;
    sprintId: string;
    taskId: string;
    workspacePath: string;
  }> => {
    const projectId = await buildAnalyzedProject(token);
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

    const workspacePath = path.join(workspaceRoot, projectId);
    return { projectId, sprintId, taskId, workspacePath };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-execution-monitor-e2e-'),
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

  it('rejects unauthenticated access to every monitor route', async () => {
    await request(app.getHttpServer())
      .get('/projects/x/execution-monitor')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/execution-history')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/execution-timeline')
      .expect(401);
  });

  it('hides the project entirely from a non-owner (404, never 403)', async () => {
    const ownerToken = await registerUser('monitor-owner');
    const { projectId } = await buildReadyProject(ownerToken);
    const otherToken = await registerUser('monitor-other');
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('returns an idle empty state before any Sprint plan exists', async () => {
    const token = await registerUser('monitor-empty');
    const projectId = await buildAnalyzedProject(token);
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.hasActiveExecution).toBe(false);
    expect(res.body.activeSprintExecution).toBeNull();
    expect(res.body.sprintProgress).toEqual([]);
  });

  it('shows Sprint progress with no active execution once a plan exists but has never run', async () => {
    const token = await registerUser('monitor-plan-ready');
    const { projectId } = await buildReadyProject(token);
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.hasActiveExecution).toBe(false);
    expect(res.body.sprintProgress).toHaveLength(1);
    expect(res.body.sprintProgress[0].totalTasks).toBe(1);
    expect(res.body.nextSprintEligible).toEqual({
      sprintId: expect.any(String),
      number: 1,
      title: 'Foundations',
    });
  });

  it('reports a full success run: COMPLETED, usage, checks, commits, and safe workspace info', async () => {
    const token = await registerUser('monitor-success');
    const { projectId, sprintId, workspacePath } =
      await buildReadyProject(token);

    generateStructuredOutput.mockResolvedValue(taskInstructionResult());
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(0)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-a.txt'), 'content');
      return agentSuccessResult();
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprintId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.activeSprintExecution.status).toBe('COMPLETED');
    expect(res.body.activeSprintExecution.currentPhase).toBe('COMPLETED');
    expect(res.body.activeSprintExecution.progressPercent).toBe(100);
    expect(res.body.usage.codingAgent).toEqual({
      inputTokens: 111,
      outputTokens: 222,
      totalTokens: 333,
    });
    expect(res.body.usage.planningAi.totalTokens).toBeGreaterThan(0);
    expect(res.body.recentCommits).toHaveLength(1);
    expect(res.body.recentCommits[0].taskKey).toBe('S1-T1');
    expect(res.body.workspace.status).toBe('READY');
    expect(res.body.workspace.clean).toBe(true);

    // Never leaks the server's absolute workspace path anywhere in the
    // response (item 27/96) — the workspacePath itself proves what to
    // search for.
    expect(JSON.stringify(res.body)).not.toContain(workspacePath);
  });

  it('reports a failure run with the failed Task, phase FAILED, and a safe error message', async () => {
    const token = await registerUser('monitor-failure');
    const { projectId, sprintId } = await buildReadyProject(token);

    generateStructuredOutput.mockResolvedValue(taskInstructionResult());
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(1)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-a.txt'), 'content');
      return agentSuccessResult();
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprintId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.activeSprintExecution.status).toBe('FAILED');
    expect(res.body.activeSprintExecution.currentPhase).toBe('FAILED');
    expect(res.body.activeSprintExecution.isLive).toBe(false);
    expect(res.body.currentTask.key).toBe('S1-T1');
    expect(res.body.currentTask.status).toBe('FAILED');
    expect(res.body.validation.status).toBe('FAILED');
    expect(res.body.validation.checks[0].status).toBe('FAILED');
    expect(typeof res.body.activeSprintExecution.errorMessage).toBe('string');
  });

  it('remains viewable for an archived project (monitoring, not mutation)', async () => {
    const token = await registerUser('monitor-archived');
    const { projectId } = await buildReadyProject(token);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.archived).toBe(true);
  });

  it('returns execution history newest-first with pagination support', async () => {
    const token = await registerUser('monitor-history');
    const { projectId, sprintId } = await buildReadyProject(token);

    generateStructuredOutput.mockResolvedValue(taskInstructionResult());
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(0)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-a.txt'), 'content');
      return agentSuccessResult();
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprintId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.executions).toHaveLength(1);
    expect(res.body.executions[0].status).toBe('COMPLETED');

    const limited = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-history?limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(limited.body.executions).toHaveLength(1);
  });

  it('paginates the execution timeline and never leaks the workspace path', async () => {
    const token = await registerUser('monitor-timeline');
    const { projectId, sprintId, workspacePath } =
      await buildReadyProject(token);

    generateStructuredOutput.mockResolvedValue(taskInstructionResult());
    executeTask.mockImplementation(async (req: CodingAgentExecutionRequest) => {
      await ensureNpmProject(req.workspacePath, {
        lint: 'node -e "process.exit(0)"',
      });
      await fs.writeFile(path.join(req.workspacePath, 'file-a.txt'), 'content');
      return agentSuccessResult();
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprintId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const full = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(full.body.events.length).toBeGreaterThan(1);
    const timestamps = full.body.events.map(
      (e: { timestamp: string }) => e.timestamp,
    );
    expect(timestamps).toEqual([...timestamps].sort().reverse());
    expect(JSON.stringify(full.body)).not.toContain(workspacePath);

    const limited = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-timeline?limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(limited.body.events).toHaveLength(1);
    expect(limited.body.nextCursor).not.toBeNull();
  });
});
