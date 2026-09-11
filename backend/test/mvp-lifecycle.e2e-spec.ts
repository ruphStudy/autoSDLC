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

const execFileAsync = promisify(execFile);

// The canonical end-to-end proof that the whole MVP lifecycle composes
// correctly across every module boundary built in Sprints 1-17 (Sprint 18,
// item 142's success criterion): one human + a mocked PlanningAIProvider +
// a mocked CodingAgentProvider + the REAL orchestrator/Git/validation
// engine = a COMPLETED software project with correct governance and
// evidence. Only the two external-AI provider boundaries are mocked
// (item 3) — every NestJS service, Prisma write, Git operation, and
// deterministic validation command in between is real.
jest.setTimeout(90000);

// ---- canonical fixture: a tiny "Simple Notes API" (item 6) ---------------

const FR_CREATE = 'FR-001';
const FR_LIST = 'FR-002';
const FR_DELETE = 'FR-003';

function analysisResult() {
  return {
    data: {
      summary: 'A simple Notes API: create, list, and delete notes.',
      targetUsers: [{ type: 'developer', description: 'API consumers' }],
      goals: ['Provide minimal note CRUD'],
      features: ['Create note', 'List notes', 'Delete note'],
      functionalRequirements: [
        {
          id: FR_CREATE,
          title: 'Create a note',
          description: 'A user can create a note.',
          priority: 'must_have',
        },
        {
          id: FR_LIST,
          title: 'List notes',
          description: 'A user can list all notes.',
          priority: 'must_have',
        },
        {
          id: FR_DELETE,
          title: 'Delete a note',
          description: 'A user can delete a note by id.',
          priority: 'must_have',
        },
      ],
      nonFunctionalRequirements: [],
      assumptions: [],
      risks: [],
      unresolvedQuestions: [],
      integrations: [],
    },
    usage: { inputTokens: 12, outputTokens: 12, totalTokens: 24 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.PROJECT_ANALYSIS,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-mvp-analysis-1',
    },
  };
}

function architectureResult() {
  return {
    data: {
      summary: 'A minimal Node.js/TypeScript in-memory Notes API.',
      frontendArchitecture: {},
      backendArchitecture: { language: 'TypeScript', runtime: 'Node.js' },
      apiArchitecture: {},
      databaseArchitecture: { storage: 'in-memory array (MVP)' },
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
          title: 'In-memory storage for MVP',
          context: 'No persistence requirement yet.',
          decision: 'Store notes in a process-local array.',
          rationale: 'Simplicity for the MVP scope.',
          alternativesConsidered: [],
          consequences: [],
        },
      ],
      requirementTraceability: [
        {
          requirementId: FR_CREATE,
          architectureAreas: ['Backend Architecture'],
        },
        { requirementId: FR_LIST, architectureAreas: ['Backend Architecture'] },
        {
          requirementId: FR_DELETE,
          architectureAreas: ['Backend Architecture'],
        },
      ],
      unresolvedQuestions: [],
      constraints: [],
    },
    usage: { inputTokens: 12, outputTokens: 12, totalTokens: 24 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.ARCHITECTURE_GENERATION,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-mvp-architecture-1',
    },
  };
}

// Two Sprints (Sprint 2 depends on Sprint 1) so the Sprint 16 acceptance
// dependency gate and Sprint 17 multi-Sprint completion are both genuinely
// exercised (item 8). Requirements are distributed FR-001/FR-002 -> Sprint
// 1, FR-003 -> Sprint 2 (item 9).
function sprintPlanContent() {
  return {
    summary: 'Two sequential Sprints delivering a minimal Notes API.',
    strategy: 'Ship create+list first, then deletion.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Support creating and listing notes.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Implement note creation',
            description:
              'Add notes.ts with an in-memory store and createNote().',
            dependencies: [],
            acceptanceCriteria: ['notes.ts exports createNote().'],
            validationExpectations: [
              { type: 'lint', description: 'Lint the code', required: true },
            ],
            requirementIds: [FR_CREATE],
            architectureAreas: ['Backend Architecture'],
          },
          {
            key: 'S1-T2',
            title: 'Implement note listing',
            description: 'Add index.ts exposing listNotes() built on notes.ts.',
            dependencies: ['S1-T1'],
            acceptanceCriteria: ['index.ts exports listNotes().'],
            validationExpectations: [
              { type: 'lint', description: 'Lint the code', required: true },
            ],
            requirementIds: [FR_LIST],
            architectureAreas: ['Backend Architecture'],
          },
        ],
      },
      {
        number: 2,
        title: 'Deletion',
        objective: 'Support deleting notes.',
        dependencies: [1],
        tasks: [
          {
            key: 'S2-T1',
            title: 'Implement note deletion',
            description: 'Extend notes.ts with deleteNote(id).',
            dependencies: [],
            acceptanceCriteria: ['notes.ts exports deleteNote().'],
            validationExpectations: [
              { type: 'lint', description: 'Lint the code', required: true },
            ],
            requirementIds: [FR_DELETE],
            architectureAreas: ['Backend Architecture'],
          },
        ],
      },
    ],
  };
}

function sprintPlanResult() {
  return {
    data: sprintPlanContent(),
    usage: { inputTokens: 12, outputTokens: 12, totalTokens: 24 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.SPRINT_PLANNING,
      latencyMs: 1,
      attempts: 1,
      requestId: 'req-mvp-sprint-plan-1',
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
    usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.TASK_INSTRUCTION,
      latencyMs: 1,
      attempts: 1,
      requestId: `req-mvp-task-instruction-${objective}`,
    },
  };
}

function acceptanceReviewResult() {
  return {
    data: {
      summary: 'Sprint delivered as planned.',
      objectiveAssessment: {
        satisfied: true,
        rationale: 'The Tasks satisfied the Sprint objective.',
      },
      requirementAssessment: { satisfied: true, gaps: [] },
      architectureAssessment: { aligned: true, concerns: [] },
      validationAssessment: { sufficient: true, concerns: [] },
      riskAssessment: { acceptable: true, concerns: [] },
      findings: [],
      recommendation: 'ACCEPT',
    },
    usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.SPRINT_REVIEW,
      latencyMs: 3,
      attempts: 1,
      requestId: 'req-mvp-sprint-review',
    },
  };
}

// Realistic-shaped mock result (item 5) — never bare SUCCEEDED with no
// change, always real file writes into the actual workspace path handed in
// the request, so the deterministic Validation Engine validates a genuinely
// real repository diff.
function agentSuccessResult(
  changedFiles: { path: string; changeType: 'ADDED' | 'MODIFIED' }[],
  summary: string,
): CodingAgentExecutionResult {
  return {
    status: 'SUCCEEDED',
    summary,
    changedFiles,
    toolActivities: [{ type: 'tool_use', name: 'Write', summary: 'Write' }],
    commandActivities: [],
    usage: { inputTokens: 6, outputTokens: 18 },
    metadata: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      durationMs: 12,
      turns: 1,
    },
  };
}

async function ensureNpmProject(workspacePath: string): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        name: 'simple-notes-api',
        version: '1.0.0',
        scripts: {
          // Deterministic, dependency-free "checks" (item 7/89) — proves
          // the real ValidationCommandExecutor/ValidationPlanResolver
          // pipeline without requiring network package installs or a real
          // linter/bundler in this sandboxed test environment.
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  try {
    await fs.access(path.join(workspacePath, 'package-lock.json'));
  } catch {
    await fs.writeFile(path.join(workspacePath, 'package-lock.json'), '{}');
  }
}

describe('MVP End-to-End Lifecycle (Sprint 18)', () => {
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

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autosdlc-mvp-lifecycle-e2e-'),
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

  it('proves the complete lifecycle: Auth -> Analysis -> Architecture -> SprintPlan -> Approval -> Workspace -> Sprint 1 -> Acceptance -> Sprint 2 -> Acceptance -> Project Completion -> ProjectDelivery', async () => {
    const http = () => request(app.getHttpServer());

    // ---- Phase 1: Auth ---------------------------------------------------
    const email = uniqueEmail('mvp-lifecycle');
    const registerRes = await http()
      .post('/auth/register')
      .send({ email, password: 'Sup3rSecret1' })
      .expect(201);
    const token = registerRes.body.accessToken as string;
    expect(token).toBeTruthy();

    // ---- Phase 2: Project --------------------------------------------------
    const projectRes = await http()
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Simple Notes API',
        brief: 'Create, list, and delete notes.',
      })
      .expect(201);
    const projectId = projectRes.body.id as string;
    expect(projectRes.body.status).toBe('DRAFT');

    // ---- Phase 3a: Project Analysis ----------------------------------------
    generateStructuredOutput.mockResolvedValueOnce(analysisResult());
    const analysisRes = await http()
      .post(`/projects/${projectId}/analysis/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(analysisRes.body.version).toBe(1);
    expect(analysisRes.body.source).toBe('AI_GENERATED');
    expect(analysisRes.body.functionalRequirements).toHaveLength(3);
    expect(analysisRes.body.provider).toBe('openai');

    const projectAfterAnalysis = await http()
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(projectAfterAnalysis.body.status).toBe('ANALYSIS_READY');

    await http()
      .post(`/projects/${projectId}/approvals/ANALYSIS`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    // ---- Phase 3b: Architecture --------------------------------------------
    generateStructuredOutput.mockResolvedValueOnce(architectureResult());
    const architectureRes = await http()
      .post(`/projects/${projectId}/architecture/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(architectureRes.body.version).toBe(1);
    expect(architectureRes.body.projectAnalysisId).toBe(analysisRes.body.id);
    expect(architectureRes.body.requirementTraceability).toHaveLength(3);

    await http()
      .post(`/projects/${projectId}/approvals/ARCHITECTURE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    // ---- Phase 3c: Sprint Plan ----------------------------------------------
    generateStructuredOutput.mockResolvedValueOnce(sprintPlanResult());
    const planRes = await http()
      .post(`/projects/${projectId}/sprint-plan/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(planRes.body.architectureId).toBe(architectureRes.body.id);
    expect(planRes.body.sprints).toHaveLength(2);
    const sprint1 = planRes.body.sprints[0];
    const sprint2 = planRes.body.sprints[1];
    expect(sprint1.tasks).toHaveLength(2);
    expect(sprint2.tasks).toHaveLength(1);
    const s1t1 = sprint1.tasks.find((t: { key: string }) => t.key === 'S1-T1');
    const s1t2 = sprint1.tasks.find((t: { key: string }) => t.key === 'S1-T2');
    const s2t1 = sprint2.tasks.find((t: { key: string }) => t.key === 'S2-T1');

    // ---- Phase 4: Approval --------------------------------------------------
    await http()
      .post(`/projects/${projectId}/approvals/SPRINT_PLAN`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    await http()
      .post(`/projects/${projectId}/approvals/START_DEVELOPMENT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);

    // ---- Phase 5: Workspace -------------------------------------------------
    await http()
      .post(`/projects/${projectId}/workspace/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const workspaceRes = await http()
      .get(`/projects/${projectId}/workspace`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(workspaceRes.body.status).toBe('READY');
    expect(workspaceRes.body.developmentBranch).toBe('autodev/development');
    const baselineSha = workspaceRes.body.headCommitSha as string;
    expect(baselineSha).toBeTruthy();

    const workspacePath = path.join(workspaceRoot, projectId);

    // ---- Phase 6: Sprint 1 execution ----------------------------------------
    // TaskInstructionService.instruction-validator re-verifies the AI's
    // acceptanceCriteria against the Task's OWN real values verbatim
    // (item 15/60/93's "never trust the AI, re-verify in code" rule) — the
    // mock must therefore echo back the exact per-Task acceptance criteria
    // it was actually asked about, detected from the rendered prompt (which
    // embeds "Task <key>: <title>"), never a generic placeholder.
    const acceptanceCriteriaByTaskKey: Record<string, string[]> = {
      'S1-T1': ['notes.ts exports createNote().'],
      'S1-T2': ['index.ts exports listNotes().'],
      'S2-T1': ['notes.ts exports deleteNote().'],
    };
    generateStructuredOutput.mockImplementation(
      async (req: { userPrompt: string }) => {
        const key = Object.keys(acceptanceCriteriaByTaskKey).find((k) =>
          req.userPrompt.includes(`Task ${k}`),
        );
        if (!key) {
          throw new Error(
            `Test mock could not determine which Task this instruction request was for: ${req.userPrompt.slice(0, 200)}`,
          );
        }
        return taskInstructionResult(
          `Implement ${key}.`,
          acceptanceCriteriaByTaskKey[key],
        );
      },
    );

    let monitorDuringTask1: {
      hasActiveExecution: boolean;
      currentTask: unknown;
    } | null = null;
    executeTask.mockImplementation(
      async (
        req: CodingAgentExecutionRequest,
      ): Promise<CodingAgentExecutionResult> => {
        await ensureNpmProject(req.workspacePath);
        if (req.taskId === s1t1.id) {
          await fs.writeFile(
            path.join(req.workspacePath, 'notes.ts'),
            'export interface Note { id: string; title: string; }\n' +
              'export const notes: Note[] = [];\n' +
              'export function createNote(title: string): Note {\n' +
              '  const note = { id: String(notes.length + 1), title };\n' +
              '  notes.push(note);\n' +
              '  return note;\n' +
              '}\n',
          );
          // Item 37/100: cross-check the monitor DURING execution (not just
          // before/after) — this call happens from inside the coding-agent
          // mock while the real orchestrator's Task loop is genuinely
          // mid-flight for this exact Task, proving the monitor reflects
          // live state rather than only a terminal snapshot.
          const mid = await http()
            .get(`/projects/${projectId}/execution-monitor`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
          monitorDuringTask1 = mid.body;
          return agentSuccessResult(
            [{ path: 'notes.ts', changeType: 'ADDED' }],
            'notes.ts written.',
          );
        }
        if (req.taskId === s1t2.id) {
          await fs.writeFile(
            path.join(req.workspacePath, 'index.ts'),
            "import { notes } from './notes';\n" +
              'export function listNotes() {\n' +
              '  return notes;\n' +
              '}\n',
          );
          return agentSuccessResult(
            [{ path: 'index.ts', changeType: 'ADDED' }],
            'index.ts written.',
          );
        }
        throw new Error(`Unexpected taskId in mock: ${req.taskId}`);
      },
    );

    await http()
      .post(`/projects/${projectId}/sprints/${sprint1.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    expect(monitorDuringTask1).not.toBeNull();
    expect(monitorDuringTask1!.hasActiveExecution).toBe(true);

    // Task 1 must have actually PASSED through the real Validation Engine
    // (item 20/21/93) — never marked PASSED directly.
    const s1t1Execution = await http()
      .get(`/projects/${projectId}/tasks/${s1t1.id}/execution/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(s1t1Execution.body.status).toBe('READY_FOR_VALIDATION');
    const s1t1Instruction = await http()
      .get(`/projects/${projectId}/tasks/${s1t1.id}/instruction`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Task 1's instruction must be grounded in the workspace baseline, not
    // some later, not-yet-reached state (item 19).
    expect(s1t1Instruction.body.repositoryHeadSha).toBe(baselineSha);

    // ---- Task Instruction freshness across sequential Tasks (item 22/57) --
    const s1t2Instruction = await http()
      .get(`/projects/${projectId}/tasks/${s1t2.id}/instruction`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Task 2's instruction must be grounded in Task 1's own commit SHA, not
    // the baseline and not some independently-refreshed "latest" read.
    const s1t1CommitShaBeforeT2 = s1t2Instruction.body
      .repositoryHeadSha as string;
    expect(s1t1CommitShaBeforeT2).not.toBe(baselineSha);

    const sprint1Execution = await http()
      .get(`/projects/${projectId}/sprints/${sprint1.id}/execution`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sprint1Execution.body.status).toBe('COMPLETED');
    expect(sprint1Execution.body.passedTasks).toBe(2);
    expect(sprint1Execution.body.totalTasks).toBe(2);

    const sprint1Detail = await http()
      .get(`/projects/${projectId}/sprint-plan`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const sprint1AfterRun = sprint1Detail.body.sprints.find(
      (s: { id: string }) => s.id === sprint1.id,
    );
    expect(sprint1AfterRun.status).toBe('PASSED');

    // ExecutionMonitorService's workspace summary is a live (never-cached)
    // Git read (Sprint 15) — unlike WorkspaceRecord.headCommitSha, which
    // only reflects the last prepare/cleanup snapshot, this reflects the
    // actual current HEAD after both Task commits.
    const monitorAfterSprint1 = await http()
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(monitorAfterSprint1.body.workspace.clean).toBe(true);
    expect(monitorAfterSprint1.body.workspace.headCommitSha).toBe(
      sprint1Execution.body.repositoryEndSha,
    );

    // ---- Sprint 2 must be blocked before Sprint 1 acceptance (item 24) ----
    const blockedRun = await http()
      .post(`/projects/${projectId}/sprints/${sprint2.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(blockedRun.body.message).toContain('SPRINT_DEPENDENCY_NOT_ACCEPTED');

    // ---- Phase 7: Sprint 1 Acceptance ---------------------------------------
    generateStructuredOutput.mockReset();
    generateStructuredOutput.mockResolvedValueOnce(acceptanceReviewResult());
    const acceptanceEligibility = await http()
      .get(
        `/projects/${projectId}/sprints/${sprint1.id}/acceptance-eligibility`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(acceptanceEligibility.body.eligible).toBe(true);

    await http()
      .post(`/projects/${projectId}/sprints/${sprint1.id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const sprint1Acceptance = await http()
      .get(`/projects/${projectId}/sprints/${sprint1.id}/acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sprint1Acceptance.body.status).toBe('READY_FOR_DECISION');
    expect(sprint1Acceptance.body.sprintExecutionId).toBe(
      sprint1Execution.body.id,
    );
    expect(sprint1Acceptance.body.sprintPlanId).toBe(planRes.body.id);
    expect(sprint1Acceptance.body.evidenceHash).toBeTruthy();
    expect(sprint1Acceptance.body.repositoryHeadSha).toBe(
      sprint1Execution.body.repositoryEndSha,
    );
    const s1RequirementIds = sprint1Acceptance.body.requirementCoverage.map(
      (r: { requirementId: string }) => r.requirementId,
    );
    expect(s1RequirementIds.sort()).toEqual([FR_CREATE, FR_LIST]);

    const acceptedSprint1 = await http()
      .post(`/projects/${projectId}/sprints/${sprint1.id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Ship it.' })
      .expect(201);
    expect(acceptedSprint1.body.status).toBe('ACCEPTED');
    expect(acceptedSprint1.body.reviewedByUserId).toBeTruthy();

    // ---- Phase 8: Sprint 2 execution -----------------------------------------
    generateStructuredOutput.mockReset();
    generateStructuredOutput.mockImplementation(async () =>
      taskInstructionResult(
        'Implement S2-T1.',
        acceptanceCriteriaByTaskKey['S2-T1'],
      ),
    );
    executeTask.mockReset();
    executeTask.mockImplementation(
      async (
        req: CodingAgentExecutionRequest,
      ): Promise<CodingAgentExecutionResult> => {
        expect(req.taskId).toBe(s2t1.id);
        await ensureNpmProject(req.workspacePath);
        const content = await fs.readFile(
          path.join(req.workspacePath, 'notes.ts'),
          'utf8',
        );
        await fs.writeFile(
          path.join(req.workspacePath, 'notes.ts'),
          content +
            'export function deleteNote(id: string): void {\n' +
            '  const index = notes.findIndex((n) => n.id === id);\n' +
            '  if (index >= 0) notes.splice(index, 1);\n' +
            '}\n',
        );
        return agentSuccessResult(
          [{ path: 'notes.ts', changeType: 'MODIFIED' }],
          'deleteNote() added.',
        );
      },
    );

    await http()
      .post(`/projects/${projectId}/sprints/${sprint2.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();

    const sprint2Execution = await http()
      .get(`/projects/${projectId}/sprints/${sprint2.id}/execution`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sprint2Execution.body.status).toBe('COMPLETED');
    expect(sprint2Execution.body.passedTasks).toBe(1);

    // ---- Phase 9: Sprint 2 Acceptance ----------------------------------------
    generateStructuredOutput.mockReset();
    generateStructuredOutput.mockResolvedValueOnce(acceptanceReviewResult());
    await http()
      .post(`/projects/${projectId}/sprints/${sprint2.id}/acceptance/generate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    await worker.runOnce();
    const acceptedSprint2 = await http()
      .post(`/projects/${projectId}/sprints/${sprint2.id}/acceptance/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(acceptedSprint2.body.status).toBe('ACCEPTED');

    // ---- Phase 10: Project Completion & Delivery -----------------------------
    const completionEligibility = await http()
      .get(`/projects/${projectId}/completion-eligibility`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(completionEligibility.body.eligible).toBe(true);
    expect(completionEligibility.body.reasons).toEqual([]);

    const completion = await http()
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(completion.body.alreadyCompleted).toBe(false);
    expect(completion.body.project.status).toBe('COMPLETED');

    const projectAfterCompletion = await http()
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(projectAfterCompletion.body.status).toBe('COMPLETED');

    const delivery = completion.body.delivery;
    expect(delivery.requiredSprints).toHaveLength(2);
    expect(delivery.taskSummary).toEqual({
      totalTasks: 3,
      passedTasks: 3,
      nonPassedTaskKeys: [],
    });
    expect(delivery.commitSummary.totalCommits).toBe(3);
    expect(delivery.repositoryBranch).toBe('autodev/development');

    // ---- Real Git verification (item 16/34/98) ----------------------------
    const liveHeadSha = await git.getHeadCommitSha(workspacePath);
    expect(delivery.repositoryFinalSha).toBe(liveHeadSha);
    expect(delivery.repositoryFinalSha).toBe(
      sprint2Execution.body.repositoryEndSha,
    );

    const { stdout: log } = await execFileAsync('git', ['log', '--oneline'], {
      cwd: workspacePath,
    });
    const commitLines = log.trim().split('\n');
    // Baseline (--allow-empty) + 3 Task commits = 4.
    expect(commitLines).toHaveLength(4);

    const { stdout: remotes } = await execFileAsync('git', ['remote'], {
      cwd: workspacePath,
    });
    expect(remotes.trim()).toBe('');

    // ---- Requirement lineage cross-check (item 55/99) -----------------------
    const coverageById = new Map(
      (
        delivery.requirementCoverage as {
          requirementId: string;
          covered: boolean;
          taskKeys: string[];
        }[]
      ).map((r) => [r.requirementId, r]),
    );
    expect(coverageById.get(FR_CREATE)).toMatchObject({
      covered: true,
      taskKeys: ['S1-T1'],
    });
    expect(coverageById.get(FR_LIST)).toMatchObject({
      covered: true,
      taskKeys: ['S1-T2'],
    });
    expect(coverageById.get(FR_DELETE)).toMatchObject({
      covered: true,
      taskKeys: ['S2-T1'],
    });

    // ---- Monitoring terminal-state cross-check (item 37/39/100) -------------
    const finalMonitor = await http()
      .get(`/projects/${projectId}/execution-monitor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(finalMonitor.body.projectStatus).toBe('COMPLETED');
    expect(finalMonitor.body.hasActiveExecution).toBe(false);
    expect(
      finalMonitor.body.sprintProgress.every(
        (s: { status: string }) => s.status === 'PASSED',
      ),
    ).toBe(true);

    // ---- No workspace path / secret leak (item 61/62) -----------------------
    const serialized = JSON.stringify({
      completion: completion.body,
      monitor: finalMonitor.body,
    });
    expect(serialized).not.toContain(workspaceRoot);

    // ---- Database integrity: no orphaned rows (item 111) ---------------------
    const taskExecutions = await prisma.taskExecution.findMany({
      where: { projectId },
    });
    expect(taskExecutions).toHaveLength(3);
    for (const te of taskExecutions) {
      expect(te.commitSha).toBeTruthy();
    }
    const agentJobs = await prisma.agentJob.findMany({ where: { projectId } });
    expect(agentJobs).toHaveLength(3);
    expect(agentJobs.every((j) => j.status === 'SUCCEEDED')).toBe(true);
    const validationAttempts = await prisma.validationAttempt.findMany({
      where: { projectId },
    });
    expect(validationAttempts.every((v) => v.status === 'PASSED')).toBe(true);

    // ---- No active Jobs remain after completion (item 112) --------------------
    const activeJobs = await prisma.job.findMany({
      where: { projectId, status: { in: ['QUEUED', 'RUNNING', 'RETRY_WAIT'] } },
    });
    expect(activeJobs).toHaveLength(0);

    // ---- Idempotent re-completion (item 45's spirit, cheap re-check) ---------
    const secondComplete = await http()
      .post(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(secondComplete.body.alreadyCompleted).toBe(true);
    expect(secondComplete.body.delivery.id).toBe(delivery.id);
  });
});
