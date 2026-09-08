import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStatus, JobType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JobService } from '../src/jobs/job.service';
import { JobWorkerService } from '../src/jobs/job-worker.service';
import { JobHandlerRegistry } from '../src/jobs/job-handler.registry';
import { JobsConfigService } from '../src/jobs/jobs.config';
import { PLANNING_AI_PROVIDER } from '../src/ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../src/ai/planning/contracts/planning-provider.interface';

// Real-Postgres integration tests: the claim/heartbeat/stale-lock mechanics
// rely on genuine `FOR UPDATE SKIP LOCKED` semantics and row-level timing
// that a mocked Prisma client cannot meaningfully exercise. Drives
// JobService/JobWorkerService directly — no HTTP layer involved.
describe('Job worker concurrency (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobService: JobService;
  let registry: JobHandlerRegistry;
  let config: JobsConfigService;
  const generateStructuredOutput = jest.fn();

  const stubProvider: PlanningAIProvider = {
    generateStructuredOutput,
    healthCheck: jest.fn(),
  };

  function newWorker(): JobWorkerService {
    return new JobWorkerService(prisma, jobService, registry, config);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jobService = moduleFixture.get(JobService);
    registry = moduleFixture.get(JobHandlerRegistry);
    config = moduleFixture.get(JobsConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('D: two concurrent workers claiming the same single job only one succeeds', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: { steps: 1 },
    });
    const workerA = newWorker();
    const workerB = newWorker();

    const [claimedA, claimedB] = await Promise.all([
      workerA.claimBatch(1),
      workerB.claimBatch(1),
    ]);

    const allClaimed = [...claimedA, ...claimedB].filter(
      (j) => j.id === job.id,
    );
    expect(allClaimed).toHaveLength(1);
    expect(claimedA.length + claimedB.length).toBe(1);
  });

  it('E: claims in priority DESC order', async () => {
    const low = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      priority: 1,
      payload: { tag: 'low' },
    });
    const high = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      priority: 5,
      payload: { tag: 'high' },
    });
    const mid = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      priority: 3,
      payload: { tag: 'mid' },
    });

    const worker = newWorker();
    const first = await worker.claimBatch(1);
    const second = await worker.claimBatch(1);
    const third = await worker.claimBatch(1);

    expect(first[0]?.id).toBe(high.id);
    expect(second[0]?.id).toBe(mid.id);
    expect(third[0]?.id).toBe(low.id);
  });

  it('F: a job scheduled in the future is not claimed', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
      scheduledAt: new Date(Date.now() + 60_000),
    });

    const worker = newWorker();
    const claimed = await worker.claimBatch(10);
    expect(claimed.some((j) => j.id === job.id)).toBe(false);
  });

  it('Q: a cancelled job is never claimed', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
    });
    // This job has no project, so JobService.cancel()'s ownership check
    // doesn't apply — exercise the same atomic transition it would perform
    // directly instead.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.CANCELLED, cancelledAt: new Date() },
    });

    const worker = newWorker();
    const claimed = await worker.claimBatch(10);
    expect(claimed.some((j) => j.id === job.id)).toBe(false);
  });

  it('R: a stale RUNNING lock with attempts remaining is recovered to RETRY_WAIT', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
      maxAttempts: 3,
    });
    const worker = newWorker();
    const [claimed] = await worker.claimBatch(1);
    expect(claimed.id).toBe(job.id);

    await prisma.job.update({
      where: { id: job.id },
      data: { lockExpiresAt: new Date(Date.now() - 1000) },
    });

    await worker.recoverStaleLocks();

    const recovered = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(recovered.status).toBe(JobStatus.RETRY_WAIT);
    expect(recovered.lockedBy).toBeNull();

    const events = await prisma.jobEvent.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['LOCK_RECOVERED', 'RETRY_SCHEDULED']),
    );
  });

  it('S: a stale RUNNING lock with no attempts remaining is recovered to FAILED', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
      maxAttempts: 1,
    });
    const worker = newWorker();
    await worker.claimBatch(1);

    await prisma.job.update({
      where: { id: job.id },
      data: { lockExpiresAt: new Date(Date.now() - 1000) },
    });

    await worker.recoverStaleLocks();

    const recovered = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(recovered.status).toBe(JobStatus.FAILED);
    expect(recovered.errorCode).toBe('job_stale_lock_exhausted');
  });

  it('T: heartbeat extends the lock for the owning worker', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
    });
    const worker = newWorker();
    const [claimed] = await worker.claimBatch(1);
    const before = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const extended = await jobService.heartbeat(claimed.id, worker.workerId);

    expect(extended).toBe(true);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.lockExpiresAt!.getTime()).toBeGreaterThanOrEqual(
      before.lockExpiresAt!.getTime(),
    );
  });

  it("U: a different worker cannot heartbeat another worker's job", async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: {},
    });
    const worker = newWorker();
    await worker.claimBatch(1);
    const before = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });

    const extended = await jobService.heartbeat(
      job.id,
      'a-completely-different-worker',
    );

    expect(extended).toBe(false);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.lockExpiresAt!.getTime()).toBe(
      before.lockExpiresAt!.getTime(),
    );
  });

  it('X: job history is recorded in chronological order through a full success lifecycle', async () => {
    const job = await jobService.enqueue({
      type: JobType.SYSTEM_TEST,
      payload: { steps: 2 },
    });
    const worker = newWorker();
    await worker.runOnce();

    const finished = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe(JobStatus.SUCCEEDED);

    // getEvents() enforces project ownership; this job has no project, so
    // read the same underlying table directly.
    const events = await prisma.jobEvent.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: 'asc' },
    });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('CREATED');
    expect(types[1]).toBe('CLAIMED');
    expect(types[types.length - 1]).toBe('SUCCEEDED');
    // Ascending timestamps confirm true chronological ordering, not just
    // insertion order coincidentally matching.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        events[i - 1].createdAt.getTime(),
      );
    }
  });

  it('two workers polling the same batch never both execute the same job (multi-worker safety)', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, () =>
        jobService.enqueue({
          type: JobType.SYSTEM_TEST,
          payload: { steps: 1 },
        }),
      ),
    );
    const workerA = newWorker();
    const workerB = newWorker();

    const [claimedA, claimedB] = await Promise.all([
      workerA.claimBatch(6),
      workerB.claimBatch(6),
    ]);

    const claimedIds = [...claimedA, ...claimedB].map((j) => j.id);
    const uniqueIds = new Set(claimedIds);
    expect(uniqueIds.size).toBe(claimedIds.length); // no id claimed twice
    expect(claimedIds.length).toBe(jobs.length); // every job claimed exactly once
  });
});
