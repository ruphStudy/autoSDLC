import type { CommitHistoryEntry, WorkspaceSummary } from './types';
import { formatDateTime, shortSha } from './format';

// Never renders an absolute filesystem path (item 27/95/96) — only
// branch/HEAD/clean state, exactly what WorkspacePanel itself already
// shows elsewhere in the app.
export function GitChangesCard({
  workspace,
  commits,
}: {
  workspace: WorkspaceSummary;
  commits: CommitHistoryEntry[];
}) {
  return (
    <section className="workspace-panel">
      <h3>Git</h3>
      <p className="approval-panel-meta">
        Workspace: {workspace.status}
        {workspace.branch && ` · Branch: ${workspace.branch}`}
        {workspace.clean !== null && ` · Working tree: ${workspace.clean ? 'CLEAN' : 'DIRTY'}`}
        {workspace.headCommitSha && ` · HEAD: ${shortSha(workspace.headCommitSha)}`}
      </p>

      {commits.length > 0 ? (
        <>
          <p className="approval-panel-meta">Commit history (local commits, not pushed):</p>
          <ul className="analysis-card-list">
            {commits.map((commit) => (
              <li key={commit.commitSha} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>
                    {commit.taskKey} <code>{shortSha(commit.commitSha)}</code>
                  </strong>
                  <span className="approval-panel-meta">{formatDateTime(commit.committedAt)}</span>
                </div>
                <p className="approval-panel-meta">
                  {commit.taskTitle}
                  {commit.changedFileCount != null &&
                    ` · ${commit.changedFileCount} file${commit.changedFileCount === 1 ? '' : 's'} changed`}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="analysis-empty-section">No commits yet.</p>
      )}
    </section>
  );
}
