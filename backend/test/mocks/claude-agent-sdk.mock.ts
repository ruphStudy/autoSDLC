// Global Jest replacement for '@anthropic-ai/claude-agent-sdk' (see
// moduleNameMapper in package.json's jest config and test/jest-e2e.json).
//
// Two independent reasons this exists:
// 1. The real package is ESM-only ("type": "module", no CJS entry point) —
//    plain Node 20.19+ can require() it natively, but Jest's module system
//    cannot, so any test that transitively imports AppModule (which loads
//    CodingAgentModule, which loads ClaudeCodingAgentProvider) would fail
//    to even parse it.
// 2. Item 68 of the Sprint 10 spec requires that automated tests never call
//    the real Claude Agent SDK (no real network calls, no token spend) —
//    this mock guarantees that structurally, not just by convention.
//
// Individual test files call `jest.mocked(query).mockImplementation(...)`
// (or mockResolvedValue/mockReturnValue) to control behavior per test; the
// default here throws so a test that forgets to configure it fails loudly
// instead of silently hanging or passing on an empty result.
export const query = jest.fn(() => {
  throw new Error(
    'claude-agent-sdk mock: query() was called without a configured mock implementation.',
  );
});
