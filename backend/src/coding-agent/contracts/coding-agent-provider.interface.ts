import type { CodingAgentExecutionRequest } from './coding-agent-request';
import type {
  CodingAgentExecutionResult,
  CodingAgentHealth,
} from './coding-agent-result';

// The one contract business/domain services depend on. No method here
// exposes a Claude Agent SDK (or any other vendor) type — implementations
// adapt their vendor's request/response shape to this on both sides. Claude
// is the first implementation, not the architecture: a future
// CodexCodingAgentProvider or GeminiCodingAgentProvider implements the same
// interface with zero changes required anywhere else.
export interface CodingAgentProvider {
  /**
   * Resolves with a result (status SUCCEEDED/FAILED/CANCELLED) for any
   * outcome where the agent session actually started — including a
   * timeout, cancellation, or a Claude-side execution error — so whatever
   * it changed before stopping is still captured in the result's
   * changedFiles/toolActivities/commandActivities. Only rejects (with a
   * CodingAgentError) for outcomes where no session could ever start at
   * all (e.g. the provider is unreachable/misconfigured, or the request
   * itself is invalid) — nothing in the workspace could possibly have been
   * touched in that case.
   */
  executeTask(
    request: CodingAgentExecutionRequest,
  ): Promise<CodingAgentExecutionResult>;

  /** Cheap, non-destructive connectivity/config check. */
  healthCheck(): Promise<CodingAgentHealth>;
}
