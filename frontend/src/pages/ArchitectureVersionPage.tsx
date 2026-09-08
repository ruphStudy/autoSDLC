import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { architectureApi } from '../api/architecture.api';
import { HistoricalApprovalBadge } from '../approval/HistoricalApprovalBadge';
import { ArchitectureContentView } from '../architecture/ArchitectureContentView';
import { ArchitectureMetadata } from '../architecture/ArchitectureMetadata';
import type { Architecture } from '../architecture/types';

export function ArchitectureVersionPage() {
  const { id, version } = useParams<{ id: string; version: string }>();
  const [architecture, setArchitecture] = useState<Architecture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !version) return;
    architectureApi
      .getArchitectureVersion(id, Number(version))
      .then(setArchitecture)
      .catch(() => setError('This architecture version could not be found.'));
  }, [id, version]);

  if (error) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to={`/projects/${id}/architecture`}>Back to current architecture</Link>
      </div>
    );
  }

  if (!architecture) {
    return <p>Loading…</p>;
  }

  return (
    <div className="analysis-page">
      <Link to={`/projects/${id}/architecture`} className="back-link">
        ← Back to current architecture
      </Link>

      <div className="page-header">
        <div>
          <h1>Architecture</h1>
          <p className="page-subtitle">
            Version {architecture.version} (read-only — this is not the current version)
          </p>
        </div>
      </div>

      <HistoricalApprovalBadge
        projectId={architecture.projectId}
        stage="ARCHITECTURE"
        version={architecture.version}
      />
      <ArchitectureMetadata architecture={architecture} />
      <ArchitectureContentView architecture={architecture} />
    </div>
  );
}
