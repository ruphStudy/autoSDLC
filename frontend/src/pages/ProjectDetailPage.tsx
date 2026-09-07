import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { StatusBadge } from '../projects/StatusBadge';
import type { Project } from '../projects/types';

const FUTURE_STAGES = ['Architecture', 'Sprint Plan', 'Development'];

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    projectsApi
      .getProject(id)
      .then(setProject)
      .catch(() => setError('This project could not be found.'));
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
          </Link>
          {FUTURE_STAGES.map((stage) => (
            <button key={stage} type="button" disabled title="Coming in a future sprint">
              {stage}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
