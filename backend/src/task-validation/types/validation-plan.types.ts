import { ValidationCheckType } from '@prisma/client';

// A fully-resolved, executable (or explicitly unresolvable) validation
// check — server-resolved only, never accepted from a client (item 23).
export interface ValidationCheck {
  type: ValidationCheckType;
  name: string;
  // Empty when unresolvable (see unavailableReason).
  command: string;
  args: string[];
  // Repository-relative (e.g. "backend") or null for the workspace root.
  workingDirectory: string | null;
  required: boolean;
  // Set when no safe, real repository command could be resolved for this
  // check — the engine never invents one (item 20).
  unavailableReason?: string;
}

export interface TaskValidationExpectation {
  type: string;
  description: string;
  required: boolean;
}
