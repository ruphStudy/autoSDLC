import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { StatusBadge } from '../projects/StatusBadge';
import type { ArchivedFilter, Project } from '../projects/types';

function excerpt(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ProjectsListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ArchivedFilter>('false');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    projectsApi
      .getProjects(tab)
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load projects. Please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  const selectTab = (next: ArchivedFilter) => {
    setTab(next);
    setProjects(null);
    setError(null);
  };

  return (
    <div className="projects-page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="page-subtitle">Everything you're building, in one place.</p>
        </div>
        <button type="button" onClick={() => navigate('/projects/new')}>
          Create Project
        </button>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={tab === 'false' ? 'tab active' : 'tab'}
          onClick={() => selectTab('false')}
        >
          Active
        </button>
        <button
          type="button"
          className={tab === 'true' ? 'tab active' : 'tab'}
          onClick={() => selectTab('true')}
        >
          Archived
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {!error && projects === null && <p>Loading projects…</p>}

      {!error && projects !== null && projects.length === 0 && (
        <div className="empty-state">
          {tab === 'true' ? (
            <p>No archived projects.</p>
          ) : (
            <>
              <p>You haven't created any projects yet.</p>
              <button type="button" onClick={() => navigate('/projects/new')}>
                Create Project
              </button>
            </>
          )}
        </div>
      )}

      {!error && projects !== null && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`} className="project-card">
                <div className="project-card-header">
                  <h2>{project.name}</h2>
                  <StatusBadge status={project.status} />
                </div>
                <p className="project-card-brief">
                  {excerpt(project.description || project.brief)}
                </p>
                <div className="project-card-meta">
                  {project.preferredStack && <span>{project.preferredStack}</span>}
                  <span>{project.repositoryType === 'EXISTING' ? 'Existing repo' : 'New repo'}</span>
                  <span>Updated {formatDate(project.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
