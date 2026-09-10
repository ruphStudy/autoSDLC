import { SprintAcceptanceReviewContent } from '../schemas/sprint-acceptance-review.schema';
import { SprintAcceptanceEvidence } from '../types/evidence.types';

export interface ValidationFailure {
  reason: string;
}

// Application-level anti-fabrication checks (items 29/31/85) — the AI's own
// adherence to the prompt's "cite real identifiers only" instruction is
// never trusted on its own; every finding's references are re-verified in
// code against the exact evidence object the prompt was built from before
// a review is ever persisted. A review with any invented reference is
// rejected outright, never silently filtered — silently dropping a
// fabricated reference would hide that the model hallucinated, which is
// itself the signal worth surfacing as a hard failure.
export function validateReviewContent(
  content: SprintAcceptanceReviewContent,
  evidence: SprintAcceptanceEvidence,
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  const validTaskKeys = new Set(evidence.tasks.map((t) => t.key));
  const validRequirementIds = new Set(
    evidence.requirementCoverage.map((r) => r.requirementId),
  );
  const validAdrIds = new Set(evidence.architectureContext.allAdrIds);

  for (const finding of content.findings) {
    for (const key of finding.relatedTaskKeys) {
      if (!validTaskKeys.has(key)) {
        failures.push({
          reason: `Finding "${finding.id}" references an invented Task key: "${key}"`,
        });
      }
    }
    for (const id of finding.relatedRequirementIds) {
      if (!validRequirementIds.has(id)) {
        failures.push({
          reason: `Finding "${finding.id}" references an invented requirement id: "${id}"`,
        });
      }
    }
    for (const id of finding.relatedAdrIds) {
      if (!validAdrIds.has(id)) {
        failures.push({
          reason: `Finding "${finding.id}" references an invented ADR id: "${id}"`,
        });
      }
    }
  }

  return failures;
}
