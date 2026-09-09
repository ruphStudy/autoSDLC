import { GitService } from '../../workspace/git/git.service';
import { ChangedFileStatus } from '../../workspace/git/git.types';
import {
  CodingAgentChangedFile,
  CodingAgentChangeType,
} from '../contracts/coding-agent-result';

function toChangeType(status: ChangedFileStatus): CodingAgentChangeType {
  switch (status) {
    case 'UNTRACKED':
      return 'ADDED';
    case 'ADDED':
    case 'MODIFIED':
    case 'DELETED':
    case 'RENAMED':
      return status;
    default:
      return 'UNKNOWN';
  }
}

// Reusable by any future CodingAgentProvider adapter (Codex, Gemini, ...) —
// provider-reported changed files can be incomplete or narrated
// inaccurately, so this is the one source of truth: since
// CodingAgentService requires a clean workspace before execution starts
// (item 41/94), everything `git status` reports afterwards is directly
// attributable to this execution, no before/after diff needed.
export async function detectChangedFiles(
  git: GitService,
  workspacePath: string,
): Promise<CodingAgentChangedFile[]> {
  const status = await git.getStatus(workspacePath);
  const seen = new Map<string, CodingAgentChangedFile>();
  for (const file of status.files) {
    if (!seen.has(file.path)) {
      seen.set(file.path, {
        path: file.path,
        changeType: toChangeType(file.status),
      });
    }
  }
  return Array.from(seen.values());
}
