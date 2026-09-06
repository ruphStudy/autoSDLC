import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { ProjectForm } from '../projects/ProjectForm';
import type { Project } from '../projects/types';

export function EditProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    projectsApi
      .getProject(id)
      .then(setProject)
      .catch(() => setError('Unable to load this project.'));
  }, [id]);

  if (error) {
    return <p className="form-error">{error}</p>;
  }

  if (!project) {
    return <p>Loading…</p>;
  }

  return (
    <div className="form-page">
      <h1>Edit Project</h1>
      <ProjectForm
        submitLabel="Save Changes"
        initialValues={{
          name: project.name,
          brief: project.brief,
          description: project.description ?? '',
          preferredStack: project.preferredStack ?? '',
          repositoryType: project.repositoryType,
          repositoryUrl: project.repositoryUrl ?? '',
        }}
        onSubmit={async (payload) => {
          await projectsApi.updateProject(project.id, payload);
          navigate(`/projects/${project.id}`, { replace: true });
        }}
        onCancel={() => navigate(`/projects/${project.id}`)}
      />
    </div>
  );
}
