import { createHash } from 'node:crypto';
import { SprintAcceptanceEvidence } from '../types/evidence.types';

// SHA-256 over the canonical deterministic evidence object (item 49) —
// proves a later Accept/Reject still corresponds to the exact evidence
// shown without needing to recompute and diff the whole object. Keys are
// already inserted in a stable order by the builder, and JSON.stringify
// preserves object key insertion order for plain objects, so this is
// deterministic across calls for identical evidence.
export function computeEvidenceHash(
  evidence: SprintAcceptanceEvidence,
): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
