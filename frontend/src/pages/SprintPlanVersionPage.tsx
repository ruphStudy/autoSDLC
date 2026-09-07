import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sprintPlanningApi } from '../api/sprint-planning.api';
import { SprintPlanContentView } from '../sprint-planning/SprintPlanContentView';
import { SprintPlanMetadata } from '../sprint-planning/SprintPlanMetadata';
import type { SprintPlan } from '../sprint-planning/types';

export function SprintPlanVersionPage() {
  const { id, version } = useParams<{ id: string; version: string }>();
  const [plan, setPlan] = useState<SprintPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !version) return;
    sprintPlanningApi
      .getSprintPlanVersion(id, Number(version))
      .then(setPlan)
      .catch(() => setError('This sprint plan version could not be found.'));
  }, [id, version]);

  if (error) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to={`/projects/${id}/sprint-plan`}>Back to current sprint plan</Link>
      </div>
    );
  }

  if (!plan) {
    return <p>Loading…</p>;
  }

  return (
    <div className="analysis-page">
      <Link to={`/projects/${id}/sprint-plan`} className="back-link">
        ← Back to current sprint plan
      </Link>

      <div className="page-header">
        <div>
          <h1>Sprint Plan</h1>
          <p className="page-subtitle">
            Version {plan.version} (read-only — this is not the current version)
          </p>
        </div>
      </div>

      <SprintPlanMetadata plan={plan} />
      <SprintPlanContentView plan={plan} />
    </div>
  );
}
