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

jest.setTimeout(30000);

const LINT_ONLY_EXPECTATIONS = [
  { type: 'lint', description: 'Lint the code', required: true },
];
const LINT_AND_BUILD_EXPECTATIONS = [
  { type: 'lint', description: 'Lint the code', required: true },
  { type: 'build', description: 'Build the project', required: true },
];

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

function sprintPlanContent(
  validationExpectations: {
    type: string;
    description: string;
    required: boolean;
  }[],
) {
  return {
    summary: 'One sprint.',
    strategy: 'Ship it.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Stand up the core model.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Add a hello-world file',
            description: 'Create hello.txt with real repository tooling.',
            dependencies: [],
            acceptanceCriteria: ['hello.txt exists.'],
            validationExpectations,
            requirementIds: ['FR-001'],
            architectureAreas: [],
          },
        ],
      },
    ],
  };
}

function sprintPlanResult(
  validationExpectations: {
    type: string;
    description: string;
    required: boolean;
  }[],
) {
  return {
    data: sprintPlanContent(validationExpectations),
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
) {
  return {
    data: {
      objective: 'Add hello.txt.',
      repositoryObservations: ['Freshly initialized repository.'],
      implementationPlan: [
        { step: 1, description: 'Add hello.txt.', likelyFiles: ['hello.txt'] },
      ],
      constraints: [],
      acceptanceCriteria: ['hello.txt exists.'],
      // Sprint 11's instruction-validator requires every REQUIRED Task
      // validation expectation to survive verbatim here.
      validationPlan: validationExpectations,
      dependencyContext: [],
      risksOrWatchouts: [],
      requirementIds: ['FR-001'],
      finalInstruction: 'TASK\nAdd hello.txt containing "hello".\n',
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
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

function agentSuccessResult(
  overrides: Partial<CodingAgentExecutionResult> = {},
): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: 'Added hello.txt and repository tooling.',
    changedFiles: [],
    toolActivities: [
      { type: 'tool_use', name: 'Write', summary: 'Write: hello.txt' },
    ],
    commandActivities: [],
    usage: { inputTokens: 10, outputTokens: 10 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 50,
      turns: 1,
    },
    ...overrides,
  };
}

// A minimal real npm project written into the real workspace by the mocked
// coding agent — this is what lets the Validation Engine run REAL `npm run
// <script>` commands (via a real child process, real npm, real Git) rather
// than mocking the executor itself (item 116/117).
async function writeMinimalNpmProject(
  workspacePath: string,
  scripts: Record<string, string>,
): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }, null, 2),
  );
  await fs.writeFile(path.join(workspacePath, 'package-lock.json'), '{}');
  await fs.writeFile(path.join(workspacePath, 'hello.txt'), 'hello');
}

describe('Task Validation / Deterministic Validation Engine (e2e)', () => {
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
        name: 'Task Validation Demo',
        brief: 'Verify the Validation Engine.',
      });
    return res.body.id as string;
  };

  // Builds a project through START_DEVELOPMENT approval and a real prepared
  // workspace, with a single Task carrying the given validation
  // expectations.
  const buildReadyProject = async (
    token: string,
    validationExpectations: {
      type: string;
      description: string;
      required: boolean;
    }[],
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

    generateStructuredOutput.mockResolvedValueOnce(
      sprintPlanResult(validationExpectations),
    );
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

  // Runs Sprint 12's Task orchestrator to completion (a real Git-fixture
  // coding-agent stub that writes a real npm project + hello.txt), leaving
  // the Task REVIEWING and ready for Sprint 13 to validate.
  const runTaskToReviewing = async (
    token: string,
    projectId: string,
    taskId: string,
    scripts: Record<string, string>,
    validationExpectations: {
      type: string;
      description: string;
      required: boolean;
    }[],
  ): Promise<void> => {
    generateStructuredOutput.mockResolvedValueOnce(
      taskInstructionResult(validationExpectations),
    );
    executeTask.mockImplementation(async (req: { workspacePath: string }) => {
      await writeMinimalNpmProject(req.workspacePath, scripts);
      return agentSuccessResult();
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks/${taskId}/validation-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.task.status).toBe('REVIEWING');
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-task-validation-e2e-'),
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

  it('rejects unauthenticated access to every validation route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/tasks/y/validate')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/validation-eligibility')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/tasks/y/validations')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/validations/z')
      .expect(401);
  });

  it('blocks validating a Task that is not REVIEWING', async () => {
    const token = await registerUser('val-not-reviewing');
    const { projectId, taskId } = await buildReadyProject(
      token,
      LINT_ONLY_EXPECTATIONS,
    );

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/${taskId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('returns 404 for a Task that does not belong to the project', async () => {
    const token = await registerUser('val-foreign-task');
    const { projectId } = await buildReadyProject(token, []);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks/does-not-exist/validate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  describe('successful validation against a real Git + npm fixture', () => {
    it('runs real lint/build commands, commits, and marks the Task PASSED', async () => {
      const token = await registerUser('val-success');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_AND_BUILD_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        {
          lint: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
        LINT_AND_BUILD_EXPECTATIONS,
      );

      const validateRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const validationAttemptId = validateRes.body.validationAttempt
        .id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/validations/${validationAttemptId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('PASSED');
      expect(detail.body.commitSha).toBeTruthy();
      expect(detail.body.runs).toHaveLength(2);
      expect(
        detail.body.runs.every(
          (r: { status: string }) => r.status === 'PASSED',
        ),
      ).toBe(true);

      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const task = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskId,
      );
      expect(task.status).toBe('PASSED');

      const workspaceStatus = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(workspaceStatus.body.clean).toBe(true);

      // Never a raw provider/SDK/child-process exception shape leaked.
      expect(JSON.stringify(detail.body)).not.toMatch(
        /Anthropic|SDKMessage|ClaudeCode/,
      );
    });

    it('rejects a duplicate validation request while one is already active', async () => {
      const token = await registerUser('val-duplicate');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_ONLY_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        { lint: 'node -e "process.exit(0)"' },
        LINT_ONLY_EXPECTATIONS,
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await worker.runOnce();
    });

    it('cannot be validated again once the Task has reached PASSED', async () => {
      const token = await registerUser('val-rerun-passed');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_ONLY_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        { lint: 'node -e "process.exit(0)"' },
        LINT_ONLY_EXPECTATIONS,
      );
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('failure path against a real Git + npm fixture — no commit, workspace preserved', () => {
    it('marks the Task FAILED, performs no commit, and leaves the workspace dirty for debugging', async () => {
      const token = await registerUser('val-failure');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_ONLY_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        { lint: 'node -e "process.exit(1)"' },
        LINT_ONLY_EXPECTATIONS,
      );

      const workspaceBefore = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const headBefore = workspaceBefore.body.headCommitSha;

      const validateRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const validationAttemptId = validateRes.body.validationAttempt
        .id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/validations/${validationAttemptId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.status).toBe('FAILED');
      expect(detail.body.commitSha).toBeNull();
      expect(detail.body.runs[0].status).toBe('FAILED');

      const plan = await request(app.getHttpServer())
        .get(`/projects/${projectId}/sprint-plan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const task = plan.body.sprints[0].tasks.find(
        (t: { id: string }) => t.id === taskId,
      );
      expect(task.status).toBe('FAILED');

      const workspaceAfter = await request(app.getHttpServer())
        .get(`/projects/${projectId}/workspace`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(workspaceAfter.body.clean).toBe(false);
      expect(workspaceAfter.body.headCommitSha).toBe(headBefore);
    });
  });

  describe('cancellation while queued', () => {
    it('cancels through the existing Sprint 8 job-cancel endpoint without ever committing', async () => {
      const token = await registerUser('val-cancel');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_ONLY_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        { lint: 'node -e "process.exit(0)"' },
        LINT_ONLY_EXPECTATIONS,
      );

      const validateRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const backgroundJobId = validateRes.body.job.id as string;

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/jobs/${backgroundJobId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await worker.runOnce();

      const jobDetail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/jobs/${backgroundJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(jobDetail.body.status).toBe('CANCELLED');

      // The Task must not be stuck — the next eligibility check self-heals
      // the orphaned validation attempt and reports REVIEWING/runnable.
      const eligibility = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/validation-eligibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(eligibility.body.task.status).toBe('REVIEWING');
      expect(eligibility.body.runnable).toBe(true);
    });
  });

  describe('ownership isolation between users', () => {
    it('hides the project entirely from a non-owner (404, never 403)', async () => {
      const ownerToken = await registerUser('val-iso-owner');
      const otherToken = await registerUser('val-iso-other');
      const { projectId, taskId } = await buildReadyProject(
        ownerToken,
        LINT_ONLY_EXPECTATIONS,
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks/${taskId}/validation-eligibility`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      expect(executeTask).not.toHaveBeenCalled();
    });
  });

  describe('archived project protection', () => {
    it('blocks validating for an archived project', async () => {
      const token = await registerUser('val-archived');
      const { projectId, taskId } = await buildReadyProject(
        token,
        LINT_ONLY_EXPECTATIONS,
      );
      await runTaskToReviewing(
        token,
        projectId,
        taskId,
        { lint: 'node -e "process.exit(0)"' },
        LINT_ONLY_EXPECTATIONS,
      );

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks/${taskId}/validate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });
});
