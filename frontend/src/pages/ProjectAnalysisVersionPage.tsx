import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { projectAnalysisApi } from '../api/project-analysis.api';
import { AnalysisContentView } from '../project-analysis/AnalysisContentView';
import { AnalysisMetadata } from '../project-analysis/AnalysisMetadata';
import type { ProjectAnalysis } from '../project-analysis/types';

export function ProjectAnalysisVersionPage() {
  const { id, version } = useParams<{ id: string; version: string }>();
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !version) return;
    projectAnalysisApi
      .getProjectAnalysisVersion(id, Number(version))
      .then(setAnalysis)
      .catch(() => setError('This analysis version could not be found.'));
  }, [id, version]);

  if (error) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to={`/projects/${id}/analysis`}>Back to current analysis</Link>
      </div>
    );
  }

  if (!analysis) {
    return <p>Loading…</p>;
  }

  return (
    <div className="analysis-page">
      <Link to={`/projects/${id}/analysis`} className="back-link">
        ← Back to current analysis
      </Link>

      <div className="page-header">
        <div>
          <h1>Project Analysis</h1>
          <p className="page-subtitle">
            Version {analysis.version} (read-only — this is not the current version)
          </p>
        </div>
      </div>

      <AnalysisMetadata analysis={analysis} />
      <AnalysisContentView analysis={analysis} />
    </div>
  );
}
