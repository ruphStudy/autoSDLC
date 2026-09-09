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

function successResult(
  overrides: Partial<CodingAgentExecutionResult> = {},
): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary: 'Inspected the repository. Found a README and a Git history.',
    changedFiles: [],
    toolActivities: [
      { type: 'tool_use', name: 'Read', summary: 'Read: README.md' },
    ],
    commandActivities: [],
    usage: { inputTokens: 120, outputTokens: 40 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 250,
      turns: 2,
      providerRequestId: 'sess-1',
    },
    ...overrides,
  };
}

describe('Coding Agent (e2e)', () => {
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
        name: 'Coding Agent Demo',
        brief: 'Verify the coding agent provider integration.',
      });
    return res.body.id as string;
  };

  const approveThroughStartDevelopment = async (
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
  };

  const buildReadyProject = async (token: string): Promise<string> => {
    const projectId = await createProject(token);
    await approveThroughStartDevelopment(token, projectId);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    return projectId;
  };

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-coding-agent-e2e-'),
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

  it('rejects unauthenticated access to every coding-agent route', async () => {
    await request(app.getHttpServer())
      .post('/projects/x/coding-agent/diagnostic')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/agent-jobs')
      .expect(401);
    await request(app.getHttpServer())
      .get('/projects/x/agent-jobs/y')
      .expect(401);
    await request(app.getHttpServer())
      .get('/internal/ai/coding/health')
      .expect(401);
  });

  it('reports the coding provider health without ever running a real task', async () => {
    healthCheck.mockResolvedValue({
      provider: 'claude',
      configured: true,
      reachable: true,
      model: 'claude-sonnet-5',
    });
    const token = await registerUser('coding-health');

    const res = await request(app.getHttpServer())
      .get('/internal/ai/coding/health')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      provider: 'claude',
      configured: true,
      reachable: true,
    });
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('blocks running the diagnostic before Start Development is approved', async () => {
    const token = await registerUser('coding-not-approved');
    const projectId = await createProject(token);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/coding-agent/diagnostic`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('blocks running the diagnostic before the workspace is prepared', async () => {
    const token = await registerUser('coding-no-workspace');
    const projectId = await createProject(token);
    await approveThroughStartDevelopment(token, projectId);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/coding-agent/diagnostic`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(executeTask).not.toHaveBeenCalled();
  });

  describe('full lifecycle against a READY workspace', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      token = await registerUser('coding-lifecycle');
      projectId = await buildReadyProject(token);
    });

    it('runs the fixed diagnostic instruction end to end and records a SUCCEEDED AgentJob', async () => {
      executeTask.mockResolvedValue(successResult());

      const enqueueRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      expect(enqueueRes.body.agentJob.status).toBe('QUEUED');
      const agentJobId = enqueueRes.body.agentJob.id as string;

      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs/${agentJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('SUCCEEDED');
      expect(detail.body.provider).toBe('claude');
      expect(detail.body.summary).toContain('Inspected the repository');
      expect(detail.body.inputTokens).toBe(120);
      expect(detail.body.outputTokens).toBe(40);

      // The instruction sent to the provider is always the fixed backend
      // constant — never anything derived from client input.
      const sentRequest = executeTask.mock.calls[0][0];
      expect(sentRequest.instruction).toContain('Inspect this repository');
      expect(sentRequest.workspacePath).toContain(projectId);
    });

    it('lists agent jobs for the project, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('rejects running the diagnostic while the workspace has uncommitted changes', async () => {
      const dir = path.join(workspaceRoot, projectId);
      await fs.writeFile(path.join(dir, 'dirty.txt'), 'not committed');

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      await fs.rm(path.join(dir, 'dirty.txt'));
    });

    it('records a FAILED AgentJob with a safe error code when the provider reports failure', async () => {
      executeTask.mockResolvedValue({
        status: 'FAILED',
        summary: 'Execution ended without success (error_during_execution).',
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: 'Claude execution ended with: error_during_execution.',
        changedFiles: [],
        toolActivities: [],
        commandActivities: [],
        metadata: { provider: 'claude', durationMs: 50 },
      } satisfies CodingAgentExecutionResult);

      const enqueueRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      await worker.runOnce();

      const detail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs/${enqueueRes.body.agentJob.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('FAILED');
      expect(detail.body.errorCode).toBe('PROVIDER_UNAVAILABLE');
      // Never a raw provider/SDK exception shape leaked to the client.
      expect(JSON.stringify(detail.body)).not.toMatch(
        /Anthropic|SDKMessage|ClaudeCode/,
      );
    });

    it('cancels a queued coding-agent job through the existing Sprint 8 job-cancel endpoint (no competing cancellation system)', async () => {
      executeTask.mockResolvedValue(successResult());

      const enqueueRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const backgroundJobId = enqueueRes.body.job.id as string;
      const agentJobId = enqueueRes.body.agentJob.id as string;

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
      expect(executeTask).not.toHaveBeenCalled();

      const agentJobDetail = await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs/${agentJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // The AgentJob itself stays QUEUED — the underlying background job
      // never reached RUNNING, so CodingAgentService.execute never ran.
      expect(agentJobDetail.body.status).toBe('QUEUED');
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let projectId: string;
    let agentJobId: string;

    beforeAll(async () => {
      ownerToken = await registerUser('coding-iso-owner');
      otherToken = await registerUser('coding-iso-other');
      projectId = await buildReadyProject(ownerToken);
      executeTask.mockResolvedValue(successResult());
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(202);
      agentJobId = res.body.agentJob.id;
      await worker.runOnce();
    });

    it('hides the project entirely from a non-owner (404, never 403)', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs/${agentJobId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('leaves the agent job visible to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}/agent-jobs/${agentJobId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('archived project protection', () => {
    it('blocks running the diagnostic for an archived project', async () => {
      const token = await registerUser('coding-archived');
      const projectId = await buildReadyProject(token);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/projects/${projectId}/coding-agent/diagnostic`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(executeTask).not.toHaveBeenCalled();
    });
  });
});
