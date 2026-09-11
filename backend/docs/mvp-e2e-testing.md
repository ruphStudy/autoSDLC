# MVP End-to-End Testing

How to run the tests that prove the whole Autonomous Development Orchestrator
lifecycle (registration through `ProjectDelivery`) actually works, not just
that each module passes in isolation.

## Prerequisites

- A disposable PostgreSQL 16+ database, never the project's own Docker
  Postgres (`docker-compose.yml`, port 5434) or any real dev/prod database.
  This repo has always used a scratch database on the host's own Postgres
  instance (port 5432) — see `DATABASE_URL` below.
- Node.js (whatever version `package.json`'s `engines` field / the CI image
  specifies).
- No Redis — this codebase has never used Redis/BullMQ. Sprint 8's
  background-job queue is Postgres itself (`Job`/`JobEvent` tables, claimed
  via `SELECT ... FOR UPDATE SKIP LOCKED`). Any instruction elsewhere
  mentioning Redis/BullMQ cleanup does not apply to this codebase.
- No AI credentials required. Every e2e test overrides both
  `PLANNING_AI_PROVIDER` and `CODING_AGENT_PROVIDER` with an in-memory
  `jest.fn()` stub — no network access, no OpenAI/Anthropic key, no cost.

## Running

```bash
export DATABASE_URL="postgresql://<user>@localhost:5432/<scratch-db-name>"
cd backend
npx jest --config ./test/jest-e2e.json <file>.e2e-spec.ts   # one file
npx jest --config ./test/jest-e2e.json --runInBand           # everything
```

Never point `DATABASE_URL` at anything but a database you know is
disposable. Before any destructive operation against it (e.g.
`prisma migrate reset`), verify the target with
`psql "$DATABASE_URL" -c "SELECT current_database(), inet_server_port();"`
and confirm the name/port match your scratch instance — Prisma's own CLI
already refuses a `migrate reset` from an AI agent without an explicit
human-authored consent string (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`),
which has proven a reliable extra safety net in practice.

## The canonical scenario

`test/mvp-lifecycle.e2e-spec.ts` is the primary proof: one HTTP-driven test
walks a fresh user through the entire product flow —

```
register -> create Project -> generate Analysis -> approve
  -> generate Architecture -> approve
  -> generate Sprint Plan (2 Sprints, 3 requirements) -> approve
  -> prepare a real temporary Git workspace
  -> run Sprint 1 (2 Tasks, real coding-agent-mock file writes,
     real Validation Engine, real Git commits)
  -> Sprint 2 blocked until Sprint 1 is accepted (real 409)
  -> generate + Accept Sprint 1's acceptance review
  -> run Sprint 2 -> generate + Accept its acceptance review
  -> completion eligibility -> POST /complete -> ProjectDelivery
```

Every module boundary in that chain is real (Prisma, Git, the deterministic
Validation Engine, the Sprint/Task orchestrators, Sprint Acceptance, Project
Delivery). Only the two external AI-provider boundaries
(`PLANNING_AI_PROVIDER`, `CODING_AGENT_PROVIDER`) are mocked, and the mocked
coding agent genuinely writes files into the real workspace so the real
Validation Engine has something real to check.

The canonical fixture is a tiny "Simple Notes API" (`FR-001` create,
`FR-002` list — Sprint 1; `FR-003` delete — Sprint 2), with validation
scripts (`lint`/`typecheck`/`test`/`build`) implemented as
`node -e "process.exit(0)"` rather than a real linter/bundler/test runner —
deterministic, dependency-free, and fast, while still exercising the real
`ValidationCommandExecutor`/`ValidationPlanResolver` pipeline end to end.

## Failure, staleness, cancellation, pause, and security coverage

Sprint 18 did not duplicate these into new files — they were already
covered (or, where a genuine gap existed, added) in each domain's own
existing e2e suite, since that keeps failures traceable to the exact module
under test rather than buried in one giant file:

| Scenario | Where |
|---|---|
| Coding-agent / validation failure blocks the Task and the Sprint | `task-execution.e2e-spec.ts`, `sprint-execution.e2e-spec.ts` |
| Stale `TaskInstruction` (repository moved) is never executed | `task-instruction.e2e-spec.ts` |
| Stale Sprint Acceptance review blocks Accept | `sprint-acceptance.e2e-spec.ts` ("blocks Accept once the repository moved...") |
| Stale Project-completion eligibility blocks `complete()` | `project-delivery.e2e-spec.ts` ("rejects completion once the repository moved...") |
| Sprint cancellation while queued, self-healing | `sprint-execution.e2e-spec.ts` |
| Pause holds the next Task; resume continues the Sprint | `sprint-execution.e2e-spec.ts` ("pause and resume") |
| Orphaned/crashed Task or validation attempt self-heals | `task-execution.e2e-spec.ts`, `task-validation.e2e-spec.ts` |
| Cross-user ownership isolation (404, never 403) | every domain's own suite |
| Archived-project mutation blocks | `sprint-execution.e2e-spec.ts`, `sprint-acceptance.e2e-spec.ts` |
| Completed-project mutation blocks (`PROJECT_COMPLETED`) | `task-execution.e2e-spec.ts` (unit), `sprint-execution.e2e-spec.ts` (unit), `sprint-acceptance.e2e-spec.ts` (unit), `project-delivery.e2e-spec.ts` (e2e) |
| Dependent-Sprint acceptance gate (`SPRINT_DEPENDENCY_NOT_ACCEPTED`) | `sprint-acceptance.e2e-spec.ts`, and exercised again inline in `mvp-lifecycle.e2e-spec.ts` |

## Known limitation: combined-run flakiness

Every e2e file passes reliably run individually or in small groups. A full
`--runInBand` run of all 20 files sharing one scratch Postgres instance can
still occasionally hit a transient `socket hang up` or `409` on a brand-new
project's very first mutating call — pre-existing, environmental connection
contention under sustained load, not a product defect (confirmed each time
by an immediate clean re-run of the affected file in isolation). Sprint 18
found and fixed one genuine contributor — `test/app.e2e-spec.ts` was
bootstrapping a full `AppModule` (its own Prisma connection pool) in
`beforeEach` with no matching `afterEach`, leaking that pool for the rest of
any combined run. If this resurfaces, first check `ps aux` /
`pg_stat_activity` for a genuinely stuck (flat CPU, idle connections) run
before assuming a hang — a slow-but-progressing run and a stuck one look
different under those two checks. A per-file scratch schema/database would
likely eliminate this entirely but is a larger test-infrastructure change,
deliberately out of scope for MVP readiness.
