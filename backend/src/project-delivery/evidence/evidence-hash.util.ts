import { createHash } from 'node:crypto';
import { ProjectDeliveryEvidence } from '../types/evidence.types';

// SHA-256 over the canonical deterministic evidence object (same pattern as
// SprintAcceptance's computeEvidenceHash) — proves the persisted
// ProjectDelivery manifest corresponds to exactly this evidence without
// needing to recompute and diff the whole object. Keys are already inserted
// in a stable order by the builder, and JSON.stringify preserves object key
// insertion order for plain objects, so this is deterministic across calls
// for identical evidence.
export function computeDeliveryEvidenceHash(
  evidence: ProjectDeliveryEvidence,
): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
