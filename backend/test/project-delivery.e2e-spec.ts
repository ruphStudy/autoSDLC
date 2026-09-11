import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { CODING_AGENT_PROVIDER } from '../src/coding-agent/coding-agent.constants';
import { CodingAgentProvider } from '../src/coding-agent/contracts/coding-agent-provider.interface';
import { CodingAgentExecutionRequest } from '../src/coding-agent/contracts/coding-agent-request';
import { CodingAgentExecutionResult } from '../src/coding-agent/contracts/coding-agent-result';

jest.setTimeout(60000);

const execFileAsync = promisify(execFile);

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

describe('Project Completion & Delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobWorkerService;
  let git: GitService;
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
      .send({ name: 'Delivery Demo', brief: 'Verify Project completion.' });
    return res.body.id as string;
  };

  // Builds a full two-Sprint plan, runs BOTH Sprints through the real
  // Sprint 12-14 orchestration pipeline to PASSED, then formally ACCEPTS
  // both via the real Sprint 16 pipeline — the exact state a Project must
  // be in for Sprint 17 completion to become eligible. Only the AI planning
  // provider, coding agent, and AI acceptance review are mocked; Git/npm/
  // validation all run for real.
  const buildFullyAcceptedProject = async (
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
    await worker.runOnce();

    generateStructuredOutput.mockResolvedValueOnce(acceptanceReviewResult());
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint2Id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint2Id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const workspacePath = path.join(workspaceRoot, projectId);
    return { projectId, sprint1Id, sprint2Id, workspacePath };
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-project-delivery-e2e-'),
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
    git = moduleFixture.get(GitService);
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

  it('rejects unauthenticated access to every completion route', async () => {
    await request(app.getHttpServer())
      .get('/projects/x/completion-eligibility')
      .expect(401);
    await request(app.getHttpServer()).post('/projects/x/complete').expect(401);
    await request(app.getHttpServer()).get('/projects/x/delivery').expect(401);
  });

  it('hides a foreign project entirely (404, never 403)', async () => {
    const ownerToken = await registerUser('delivery-owner');
    const { projectId } = await buildFullyAcceptedProject(ownerToken);
    const otherToken = await registerUser('delivery-other');
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('reports not eligible with concrete reasons before any Sprint has run', async () => {
    const token = await registerUser('delivery-not-ready');
    const projectId = await createProject(token);

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(false);
    expect(eligibility.body.reasons).toContain('NO_SPRINT_PLAN');
  });

  // Regression: GET .../delivery on a Project with no ProjectDelivery yet
  // must be an ordinary 404, never a 500 (caught by manual browser
  // verification, not by any prior automated test).
  it('returns 404 (never 500) from GET delivery when nothing has been delivered yet', async () => {
    const token = await registerUser('delivery-not-found');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/delivery`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('blocks completion until every required Sprint is both PASSED and ACCEPTED', async () => {
    const token = await registerUser('delivery-partial');
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

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(false);
    expect(eligibility.body.reasons).toEqual(
      expect.arrayContaining(['SPRINT_NOT_PASSED']),
    );

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it("completes a Project once every Sprint is PASSED and ACCEPTED, with the manifest's final SHA matching the real live workspace HEAD", async () => {
    const token = await registerUser('delivery-complete');
    const { projectId, workspacePath } = await buildFullyAcceptedProject(token);

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(true);
    expect(eligibility.body.reasons).toEqual([]);

    const completion = await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(completion.body.alreadyCompleted).toBe(false);
    expect(completion.body.project.status).toBe('COMPLETED');
    expect(completion.body.delivery.requiredSprints).toHaveLength(2);
    expect(completion.body.delivery.taskSummary).toEqual({
      totalTasks: 2,
      passedTasks: 2,
      nonPassedTaskKeys: [],
    });
    expect(
      completion.body.delivery.requirementCoverage.every(
        (r: { covered: boolean }) => r.covered,
      ),
    ).toBe(true);

    // The real Git fixture proof (no mocked Git anywhere in this flow):
    // the persisted manifest's final SHA must equal the actual live HEAD of
    // the actual prepared workspace on disk.
    const liveHeadSha = await git.getHeadCommitSha(workspacePath);
    expect(completion.body.delivery.repositoryFinalSha).toBe(liveHeadSha);

    const projectRow = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(projectRow.status).toBe('COMPLETED');
    expect(projectRow.completedAt).not.toBeNull();

    const getDelivery = await request(app.getHttpServer())
      .get(`/projects/${projectId}/delivery`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getDelivery.body.repositoryFinalSha).toBe(liveHeadSha);
  });

  it('is idempotent: completing an already-completed Project returns the existing delivery without creating a new one', async () => {
    const token = await registerUser('delivery-idempotent');
    const { projectId } = await buildFullyAcceptedProject(token);

    const first = await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(second.body.alreadyCompleted).toBe(true);
    expect(second.body.delivery.id).toBe(first.body.delivery.id);
    expect(second.body.delivery.version).toBe(first.body.delivery.version);

    const deliveries = await prisma.projectDelivery.findMany({
      where: { projectId },
    });
    expect(deliveries).toHaveLength(1);
  });

  it('blocks completion when the live workspace is dirty', async () => {
    const token = await registerUser('delivery-dirty');
    const { projectId, workspacePath } = await buildFullyAcceptedProject(token);

    await fs.writeFile(
      path.join(workspacePath, 'untracked-leftover.txt'),
      'oops',
    );

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(false);
    expect(eligibility.body.reasons).toContain('WORKSPACE_DIRTY');

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    await fs.rm(path.join(workspacePath, 'untracked-leftover.txt'));
  });

  // Sprint 18 item 45: eligibility passing once is not a permanent
  // guarantee — if the repository moves afterward (here, a real commit made
  // directly against the workspace, outside the orchestrator entirely),
  // finalization must reject the now-stale state rather than trusting the
  // earlier eligibility snapshot.
  it('rejects completion once the repository moved after eligibility was last confirmed', async () => {
    const token = await registerUser('delivery-stale');
    const { projectId, workspacePath } = await buildFullyAcceptedProject(token);

    const eligibility = await request(app.getHttpServer())
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eligibility.body.eligible).toBe(true);

    await fs.writeFile(
      path.join(workspacePath, 'out-of-band.txt'),
      'unexpected change',
    );
    await execFileAsync('git', ['add', '.'], { cwd: workspacePath });
    await execFileAsync(
      'git',
      ['commit', '-m', 'out-of-band change after eligibility check'],
      { cwd: workspacePath },
    );

    const blocked = await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(blocked.body.message).toContain('FINAL_SHA_MISMATCH');

    const projectRow = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(projectRow.status).not.toBe('COMPLETED');
    const deliveries = await prisma.projectDelivery.findMany({
      where: { projectId },
    });
    expect(deliveries).toHaveLength(0);
  });

  it('blocks re-running a Sprint and generating a new Sprint Acceptance review once the Project is COMPLETED', async () => {
    const token = await registerUser('delivery-post-completion');
    const { projectId, sprint1Id } = await buildFullyAcceptedProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const rerun = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(rerun.body.message).toContain('PROJECT_COMPLETED');

    const regenerate = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sprints/${sprint1Id}/acceptance/regenerate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(regenerate.body.message).toContain('PROJECT_COMPLETED');
  });
});
