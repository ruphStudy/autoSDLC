import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { approvalApi } from '../api/approval.api';
import { StatusBadge } from '../projects/StatusBadge';
import { JobsPanel } from '../jobs/JobsPanel';
import { WorkspacePanel } from '../workspace/WorkspacePanel';
import { CodingAgentPanel } from '../coding-agent/CodingAgentPanel';
import type { Project } from '../projects/types';
import type { ApprovalSummary, ApprovalSummaryEntry } from '../approval/types';

function stageStatusLabel(entry?: ApprovalSummaryEntry): string | null {
  if (!entry || entry.version == null) return null;
  if (entry.decision === 'APPROVED') return 'Approved';
  if (entry.decision === 'CHANGES_REQUESTED') return 'Changes Requested';
  return 'Ready for Review';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    projectsApi
      .getProject(id)
      .then(setProject)
      .catch(() => setError('This project could not be found.'));
    approvalApi
      .getSummary(id)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [id]);

  const handleArchive = async () => {
    if (!project) return;
    if (!window.confirm('Archive this project? You can restore it later from the Archived tab.')) {
      return;
    }
    setBusy(true);
    try {
      await projectsApi.archiveProject(project.id);
      navigate('/projects');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const updated = await projectsApi.restoreProject(project.id);
      setProject(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    if (
      !window.confirm(
        'Permanently delete this project? This cannot be undone and all project data will be lost.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await projectsApi.deleteProject(project.id);
      navigate('/projects');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    );
  }

  if (!project) {
    return <p>Loading…</p>;
  }

  return (
    <div className="project-detail">
      <Link to="/projects" className="back-link">
        ← Back to projects
      </Link>

      <div className="project-detail-header">
        <div>
          <h1>{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        <div className="project-detail-actions">
          <Link to={`/projects/${project.id}/edit`}>Edit</Link>
          {project.archivedAt ? (
            <button type="button" onClick={handleRestore} disabled={busy}>
              Restore
            </button>
          ) : (
            <button type="button" onClick={handleArchive} disabled={busy}>
              Archive
            </button>
          )}
          <button type="button" className="destructive" onClick={handleDelete} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      <section className="project-overview">
        {project.description && (
          <div>
            <h3>Description</h3>
            <p>{project.description}</p>
          </div>
        )}

        <div>
          <h3>Brief</h3>
          <p className="preserve-whitespace">{project.brief}</p>
        </div>

        <div className="project-overview-grid">
          <div>
            <h3>Preferred stack</h3>
            <p>{project.preferredStack || '—'}</p>
          </div>
          <div>
            <h3>Repository</h3>
            <p>{project.repositoryType === 'EXISTING' ? 'Existing repository' : 'New repository'}</p>
            {project.repositoryUrl && <p>{project.repositoryUrl}</p>}
          </div>
          <div>
            <h3>Created</h3>
            <p>{formatDateTime(project.createdAt)}</p>
          </div>
          <div>
            <h3>Last updated</h3>
            <p>{formatDateTime(project.updatedAt)}</p>
          </div>
        </div>
      </section>

      <section className="future-stages">
        <h3>Workflow</h3>
        <div className="stage-nav">
          <Link to={`/projects/${project.id}/analysis`} className="stage-nav-link">
            Analysis
            {stageStatusLabel(summary?.analysis) && ` — ${stageStatusLabel(summary?.analysis)}`}
          </Link>

          {summary?.analysis.decision === 'APPROVED' ? (
            <Link to={`/projects/${project.id}/architecture`} className="stage-nav-link">
              Architecture
              {stageStatusLabel(summary?.architecture) &&
                ` — ${stageStatusLabel(summary?.architecture)}`}
            </Link>
          ) : (
            <button type="button" disabled title="Locked until Analysis is approved">
              Architecture
            </button>
          )}

          {summary?.architecture.decision === 'APPROVED' ? (
            <Link to={`/projects/${project.id}/sprint-plan`} className="stage-nav-link">
              Sprint Plan
              {stageStatusLabel(summary?.sprintPlan) &&
                ` — ${stageStatusLabel(summary?.sprintPlan)}`}
            </Link>
          ) : (
            <button type="button" disabled title="Locked until Architecture is approved">
              Sprint Plan
            </button>
          )}

          <button
            type="button"
            disabled
            title={
              summary?.startDevelopment.decision === 'APPROVED'
                ? 'Approved — execution engine not started yet'
                : 'Locked until the Sprint Plan and Start Development are approved'
            }
          >
            Development
            {summary?.startDevelopment.decision === 'APPROVED' && ' — Approved'}
          </button>
        </div>
      </section>

      <JobsPanel
        projectId={project.id}
        canPrepareDevelopment={summary?.startDevelopment.decision === 'APPROVED'}
      />

      <WorkspacePanel
        projectId={project.id}
        canPrepareDevelopment={summary?.startDevelopment.decision === 'APPROVED'}
      />

      <CodingAgentPanel
        projectId={project.id}
        canPrepareDevelopment={summary?.startDevelopment.decision === 'APPROVED'}
      />
    </div>
  );
}
