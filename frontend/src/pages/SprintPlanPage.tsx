import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { sprintPlanningApi } from '../api/sprint-planning.api';
import { architectureApi } from '../api/architecture.api';
import { projectsApi } from '../api/projects.api';
import { ApprovalPanel } from '../approval/ApprovalPanel';
import { StartDevelopmentPanel } from '../approval/StartDevelopmentPanel';
import { SprintPlanContentView } from '../sprint-planning/SprintPlanContentView';
import { SprintPlanMetadata } from '../sprint-planning/SprintPlanMetadata';
import type { SprintPlan, SprintPlanVersionSummary } from '../sprint-planning/types';
import type { ArchitectureVersionSummary } from '../architecture/types';
import type { Project } from '../projects/types';

const GENERATING_MESSAGES = [
  'Reviewing architecture and requirements…',
  'Sequencing sprints and dependencies…',
  'Breaking work into tasks…',
];

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

export function SprintPlanPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<SprintPlan | null>(null);
  const [versions, setVersions] = useState<SprintPlanVersionSummary[]>([]);
  const [architectureVersions, setArchitectureVersions] = useState<ArchitectureVersionSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(GENERATING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);
  const messageIndex = useRef(0);

  const architectureVersionFor = (architectureId: string): number | undefined =>
    architectureVersions.find((v) => v.id === architectureId)?.version;

  const load = async (projectId: string) => {
    const [projectResult, planResult, architectureVersionsResult] = await Promise.allSettled([
      projectsApi.getProject(projectId),
      sprintPlanningApi.getSprintPlan(projectId),
      architectureApi.getArchitectureVersions(projectId),
    ]);

    if (projectResult.status === 'fulfilled') {
      setProject(projectResult.value);
    }
    if (architectureVersionsResult.status === 'fulfilled') {
      setArchitectureVersions(architectureVersionsResult.value);
    }
    if (planResult.status === 'fulfilled') {
      setPlan(planResult.value);
      const versionList = await sprintPlanningApi.getSprintPlanVersions(projectId);
      setVersions(versionList);
    } else {
      setPlan(null);
      setVersions([]);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    load(id).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!working) return;
    const interval = setInterval(() => {
      messageIndex.current = (messageIndex.current + 1) % GENERATING_MESSAGES.length;
      setGeneratingMessage(GENERATING_MESSAGES[messageIndex.current]);
    }, 2500);
    return () => clearInterval(interval);
  }, [working]);

  const handleGenerate = async () => {
    if (!id || working) return;
    messageIndex.current = 0;
    setGeneratingMessage(GENERATING_MESSAGES[0]);
    setWorking(true);
    setError(null);
    try {
      const result = await sprintPlanningApi.generateSprintPlan(id);
      setPlan(result);
      const versionList = await sprintPlanningApi.getSprintPlanVersions(id);
      setVersions(versionList);
    } catch (err) {
      setError(errorMessage(err, 'Sprint plan generation failed. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRegenerate = async () => {
    if (!id || working) return;
    if (
      !window.confirm(
        'Generate a fresh sprint plan from the latest Architecture? Previous plan versions will be preserved.',
      )
    ) {
      return;
    }
    messageIndex.current = 0;
    setGeneratingMessage(GENERATING_MESSAGES[0]);
    setWorking(true);
    setError(null);
    try {
      const result = await sprintPlanningApi.regenerateSprintPlan(id);
      setPlan(result);
      const versionList = await sprintPlanningApi.getSprintPlanVersions(id);
      setVersions(versionList);
    } catch (err) {
      setError(errorMessage(err, 'Sprint plan regeneration failed. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <p>Loading…</p>;
  }

  if (!project) {
    return (
      <div>
        <p className="form-error">This project could not be found.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    );
  }

  return (
    <div className="analysis-page">
      <Link to={`/projects/${project.id}`} className="back-link">
        ← Back to project
      </Link>

      <div className="page-header">
        <div>
          <h1>Sprint Plan</h1>
          <p className="page-subtitle">{project.name}</p>
        </div>
        {plan && (
          <div className="project-detail-actions">
            <Link to={`/projects/${project.id}/sprint-plan/edit`}>Edit Sprint Plan</Link>
            <button type="button" onClick={handleRegenerate} disabled={working}>
              Regenerate Sprint Plan
            </button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {working && (
        <div className="analyzing-state">
          <p>{generatingMessage}</p>
        </div>
      )}

      {!working && !plan && (
        <div className="empty-state">
          <p>This project doesn't have a sprint plan yet.</p>
          <p className="page-subtitle">
            The sprint plan is generated from your current Architecture. Make sure that's reviewed
            and ready first.
          </p>
          <button type="button" onClick={handleGenerate}>
            Generate Sprint Plan
          </button>
        </div>
      )}

      {!working && plan && (
        <>
          <p className="page-subtitle">
            Based on Architecture{' '}
            {architectureVersionFor(plan.architectureId)
              ? `v${architectureVersionFor(plan.architectureId)}`
              : '(version unavailable)'}
          </p>
          <ApprovalPanel projectId={project.id} stage="SPRINT_PLAN" currentVersion={plan.version} />
          <SprintPlanMetadata
            plan={plan}
            architectureVersion={architectureVersionFor(plan.architectureId)}
          />
          <SprintPlanContentView plan={plan} canPreviewInstructions canRunTasks />

          {versions.length > 1 && (
            <section className="analysis-section">
              <h3>Version History</h3>
              <ul className="analysis-version-list">
                {versions.map((v) => (
                  <li key={v.id}>
                    {v.version === plan.version ? (
                      <span>
                        Version {v.version} —{' '}
                        {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'} (current)
                      </span>
                    ) : (
                      <Link to={`/projects/${project.id}/sprint-plan/versions/${v.version}`}>
                        Version {v.version} —{' '}
                        {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'}
                        {v.source === 'AI_GENERATED' && architectureVersionFor(v.architectureId)
                          ? ` — based on Architecture v${architectureVersionFor(v.architectureId)}`
                          : ''}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <StartDevelopmentPanel projectId={project.id} />
        </>
      )}
    </div>
  );
}
