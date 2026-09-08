import { useEffect, useState } from 'react';
import axios from 'axios';
import { workspaceApi } from '../api/workspace.api';
import { ACTIVE_WORKSPACE_STATUSES, type ChangedFile, type Workspace, type WorkspaceStatus } from './types';

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  NOT_PREPARED: 'Not Prepared',
  PREPARING: 'Preparing…',
  READY: 'Ready',
  INVALID: 'Invalid',
  FAILED: 'Failed',
  CLEANING: 'Cleaning up…',
};

const STATUS_TONE: Record<WorkspaceStatus, string> = {
  NOT_PREPARED: 'neutral',
  PREPARING: 'progress',
  READY: 'success',
  INVALID: 'danger',
  FAILED: 'danger',
  CLEANING: 'paused',
};

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Manages the isolated Git workspace for a Project: prepare (init-or-clone
// on the autonomous development branch), inspect status/diff, and clean up.
// Kept deliberately independent of JobsPanel — a WORKSPACE_PREPARE job
// drives preparation in the background, but this panel only ever reads and
// acts on workspace state, never job internals.
export function WorkspacePanel({
  projectId,
  canPrepareDevelopment,
}: {
  projectId: string;
  canPrepareDevelopment: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const load = () => {
    workspaceApi
      .get(projectId)
      .then(setWorkspace)
      .catch(() => setError('Could not load the workspace.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!workspace || !ACTIVE_WORKSPACE_STATUSES.includes(workspace.status)) {
      return;
    }
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  useEffect(() => {
    if (workspace?.status !== 'READY') {
      setFiles(null);
      setDiff(null);
      setShowDiff(false);
      return;
    }
    workspaceApi
      .getStatus(projectId)
      .then((result) => setFiles(result.files))
      .catch(() => setFiles(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspace?.status, workspace?.updatedAt]);

  const handlePrepare = async () => {
    setWorking(true);
    setError(null);
    try {
      const { workspace: updated } = await workspaceApi.prepare(projectId);
      setWorkspace(updated);
    } catch (err) {
      setError(errorMessage(err, 'Could not prepare the workspace. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleCleanup = async () => {
    if (
      !window.confirm(
        'Clean up this workspace? The local clone/working directory will be deleted. This does not affect a remote repository.',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const updated = await workspaceApi.cleanup(projectId);
      setWorkspace(updated);
    } catch (err) {
      setError(errorMessage(err, 'Could not clean up the workspace.'));
    } finally {
      setWorking(false);
    }
  };

  const handleToggleDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    setError(null);
    try {
      const result = await workspaceApi.getDiff(projectId);
      setDiff(result.diff);
      setShowDiff(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the diff.'));
    }
  };

  if (!workspace) {
    return (
      <section className="workspace-panel">
        <h3>Development Workspace</h3>
        {error ? <p className="form-error">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const canPrepare =
    canPrepareDevelopment &&
    (workspace.status === 'NOT_PREPARED' ||
      workspace.status === 'INVALID' ||
      workspace.status === 'FAILED');
  const canCleanup = !ACTIVE_WORKSPACE_STATUSES.includes(workspace.status) && workspace.status !== 'NOT_PREPARED';

  return (
    <section className="workspace-panel">
      <div className="page-header">
        <h3>Development Workspace</h3>
        <div className="workspace-panel-actions">
          {canPrepare && (
            <button type="button" onClick={handlePrepare} disabled={working}>
              {workspace.status === 'NOT_PREPARED' ? 'Prepare Workspace' : 'Re-prepare Workspace'}
            </button>
          )}
          {canCleanup && (
            <button type="button" className="secondary" onClick={handleCleanup} disabled={working}>
              Clean Up
            </button>
          )}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="job-card-header">
        <span>Status</span>
        <span className={`status-badge status-badge--${STATUS_TONE[workspace.status]}`}>
          {STATUS_LABEL[workspace.status]}
        </span>
      </div>

      {workspace.status === 'FAILED' && workspace.errorMessage && (
        <p className="form-error">{workspace.errorMessage}</p>
      )}

      {workspace.status === 'READY' && (
        <>
          <p className="approval-panel-meta">
            Branch <code>{workspace.currentBranch}</code> · HEAD{' '}
            <code>{shortSha(workspace.headCommitSha)}</code> ·{' '}
            {workspace.clean ? 'Clean' : 'Uncommitted changes'}
            {workspace.remoteName && ' · Remote configured'}
          </p>
          <p className="approval-panel-meta">
            Prepared {formatDate(workspace.preparedAt)} · Last validated{' '}
            {formatDate(workspace.lastValidatedAt)}
          </p>

          {files && files.length > 0 && (
            <ul className="job-list">
              {files.map((file) => (
                <li key={`${file.path}-${file.staged}`} className="job-card">
                  <div className="job-card-header">
                    <span>{file.path}</span>
                    <span className="approval-panel-meta">
                      {file.status}
                      {file.staged ? ' (staged)' : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {files && files.length === 0 && (
            <p className="analysis-empty-section">No changed files.</p>
          )}

          <button type="button" className="secondary" onClick={handleToggleDiff}>
            {showDiff ? 'Hide Diff' : 'View Diff'}
          </button>
          {showDiff && (
            <pre className="workspace-diff">{diff && diff.length > 0 ? diff : 'No differences.'}</pre>
          )}
        </>
      )}
    </section>
  );
}
