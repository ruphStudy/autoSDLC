// Application-owned DI token. Business services depend on this, never on
// ClaudeCodingAgentProvider directly, so swapping/adding a coding provider
// later (Codex, Gemini, Copilot) never touches CodingAgentService — only
// this binding. Mirrors PLANNING_AI_PROVIDER's role from Sprint 3.
export const CODING_AGENT_PROVIDER = Symbol('CODING_AGENT_PROVIDER');

// Applied at the API boundary (CreateDiagnosticDto) — large enough for a
// substantial future Sprint 11 task instruction, small enough to reject an
// accidental multi-megabyte payload.
export const CODING_AGENT_MAX_INSTRUCTION_BYTES = 100_000;

// The fixed diagnostic instruction used by the read-only diagnostic
// endpoint (item 51/52) — clients never supply an arbitrary prompt.
export const CODING_AGENT_DIAGNOSTIC_INSTRUCTION =
  'Inspect this repository and return a short summary of its top-level ' +
  'structure. Do not create, modify, or delete any files.';
