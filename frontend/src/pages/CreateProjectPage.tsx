import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { ProjectForm } from '../projects/ProjectForm';

export function CreateProjectPage() {
  const navigate = useNavigate();

  return (
    <div className="form-page">
      <h1>Create Project</h1>
      <ProjectForm
        submitLabel="Create Project"
        onSubmit={async (payload) => {
          const project = await projectsApi.createProject(payload);
          navigate(`/projects/${project.id}`, { replace: true });
        }}
        onCancel={() => navigate('/projects')}
      />
    </div>
  );
}
