import { validateReviewContent } from './review-validator';
import { SprintAcceptanceEvidence } from '../types/evidence.types';
import { SprintAcceptanceReviewContent } from '../schemas/sprint-acceptance-review.schema';

function buildEvidence(): SprintAcceptanceEvidence {
  return {
    sprint: {
      id: 's1',
      number: 1,
      title: 'Foundations',
      objective: 'Ship it.',
      status: 'PASSED',
    },
    sprintPlan: { id: 'plan-1', version: 1 },
    architecture: { id: 'arch-1', version: 1 },
    projectAnalysis: { id: 'analysis-1', version: 1 },
    sprintExecution: {
      id: 'exec-1',
      attempt: 1,
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
      repositoryStartSha: null,
      repositoryEndSha: null,
      totalTasks: 1,
      passedTasks: 1,
    },
    tasks: [
      {
        key: 'S1-T1',
        title: 'Add file A',
        description: 'x',
        status: 'PASSED',
        acceptanceCriteria: [],
        requirementIds: ['FR-001'],
        architectureAreas: [],
        executionAttempt: 1,
        commitSha: 'sha-1',
        changedFileCount: 1,
        validationStatus: 'PASSED',
        validationRequiredPassed: 1,
        validationRequiredFailed: 0,
      },
    ],
    requirementCoverage: [
      {
        requirementId: 'FR-001',
        title: 'Do the thing',
        taskKeys: ['S1-T1'],
        tasksPassed: true,
        validationPassed: true,
        commitShas: ['sha-1'],
      },
    ],
    architectureContext: {
      relevantAreas: [],
      relevantAdrs: [{ id: 'ADR-001', title: 'Use Postgres', decision: 'x' }],
      allAdrIds: ['ADR-001'],
    },
    validationSummary: {
      totalRuns: 1,
      requiredRuns: 1,
      requiredPassed: 1,
      optionalPassed: 0,
      optionalFailed: 0,
      failedRequiredChecks: [],
    },
    commitSummary: {
      startSha: null,
      endSha: null,
      commits: [],
      chainComplete: true,
    },
    riskSummary: {
      projectRisks: [],
      unresolvedArchitectureQuestions: [],
      optionalValidationFailures: [],
    },
    changedFiles: [],
    workspace: {
      clean: true,
      headCommitSha: 'sha-1',
      branch: 'autodev/development',
    },
  };
}

function buildReview(
  overrides: Partial<SprintAcceptanceReviewContent> = {},
): SprintAcceptanceReviewContent {
  return {
    summary: 'Sprint delivered as planned.',
    objectiveAssessment: { satisfied: true, rationale: 'All Tasks passed.' },
    requirementAssessment: { satisfied: true, gaps: [] },
    architectureAssessment: { aligned: true, concerns: [] },
    validationAssessment: { sufficient: true, concerns: [] },
    riskAssessment: { acceptable: true, concerns: [] },
    findings: [],
    recommendation: 'ACCEPT',
    ...overrides,
  };
}

describe('validateReviewContent', () => {
  it('accepts a review that references only real Task keys, requirement ids, and ADR ids', () => {
    const review = buildReview({
      findings: [
        {
          id: 'f1',
          severity: 'LOW',
          category: 'QUALITY',
          title: 'Minor note',
          description: 'x',
          evidence: [],
          relatedTaskKeys: ['S1-T1'],
          relatedRequirementIds: ['FR-001'],
          relatedAdrIds: ['ADR-001'],
          blocking: false,
        },
      ],
    });
    expect(validateReviewContent(review, buildEvidence())).toEqual([]);
  });

  it('rejects a finding that references an invented Task key', () => {
    const review = buildReview({
      findings: [
        {
          id: 'f1',
          severity: 'LOW',
          category: 'QUALITY',
          title: 'x',
          description: 'x',
          evidence: [],
          relatedTaskKeys: ['S9-T9'],
          relatedRequirementIds: [],
          relatedAdrIds: [],
          blocking: false,
        },
      ],
    });
    const failures = validateReviewContent(review, buildEvidence());
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain('S9-T9');
  });

  it('rejects a finding that references an invented requirement id', () => {
    const review = buildReview({
      findings: [
        {
          id: 'f1',
          severity: 'LOW',
          category: 'REQUIREMENT',
          title: 'x',
          description: 'x',
          evidence: [],
          relatedTaskKeys: [],
          relatedRequirementIds: ['FR-999'],
          relatedAdrIds: [],
          blocking: false,
        },
      ],
    });
    const failures = validateReviewContent(review, buildEvidence());
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain('FR-999');
  });

  it('rejects a finding that references an invented ADR id', () => {
    const review = buildReview({
      findings: [
        {
          id: 'f1',
          severity: 'MEDIUM',
          category: 'ARCHITECTURE',
          title: 'x',
          description: 'x',
          evidence: [],
          relatedTaskKeys: [],
          relatedRequirementIds: [],
          relatedAdrIds: ['ADR-999'],
          blocking: false,
        },
      ],
    });
    const failures = validateReviewContent(review, buildEvidence());
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain('ADR-999');
  });

  it('reports every invented reference across multiple findings, not just the first', () => {
    const review = buildReview({
      findings: [
        {
          id: 'f1',
          severity: 'LOW',
          category: 'OTHER',
          title: 'x',
          description: 'x',
          evidence: [],
          relatedTaskKeys: ['S9-T9'],
          relatedRequirementIds: [],
          relatedAdrIds: [],
          blocking: false,
        },
        {
          id: 'f2',
          severity: 'LOW',
          category: 'OTHER',
          title: 'x',
          description: 'x',
          evidence: [],
          relatedTaskKeys: [],
          relatedRequirementIds: ['FR-999'],
          relatedAdrIds: [],
          blocking: false,
        },
      ],
    });
    const failures = validateReviewContent(review, buildEvidence());
    expect(failures).toHaveLength(2);
  });

  it('accepts a review with no findings at all', () => {
    expect(
      validateReviewContent(buildReview({ findings: [] }), buildEvidence()),
    ).toEqual([]);
  });
});
