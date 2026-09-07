import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { architectureApi } from '../api/architecture.api';
import { projectAnalysisApi } from '../api/project-analysis.api';
import { projectsApi } from '../api/projects.api';
import { ArchitectureContentView } from '../architecture/ArchitectureContentView';
import { ArchitectureMetadata } from '../architecture/ArchitectureMetadata';
import type { Architecture, ArchitectureVersionSummary } from '../architecture/types';
import type { AnalysisVersionSummary } from '../project-analysis/types';
import type { Project } from '../projects/types';

const GENERATING_MESSAGES = [
  'Reviewing project analysis…',
  'Designing system boundaries…',
  'Structuring the technical architecture…',
];

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

export function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [architecture, setArchitecture] = useState<Architecture | null>(null);
  const [versions, setVersions] = useState<ArchitectureVersionSummary[]>([]);
  const [analysisVersions, setAnalysisVersions] = useState<AnalysisVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(GENERATING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);
  const messageIndex = useRef(0);

  const analysisVersionFor = (projectAnalysisId: string): number | undefined =>
    analysisVersions.find((v) => v.id === projectAnalysisId)?.version;

  const load = async (projectId: string) => {
    const [projectResult, architectureResult, analysisVersionsResult] = await Promise.allSettled([
      projectsApi.getProject(projectId),
      architectureApi.getArchitecture(projectId),
      projectAnalysisApi.getProjectAnalysisVersions(projectId),
    ]);

    if (projectResult.status === 'fulfilled') {
      setProject(projectResult.value);
    }
    if (analysisVersionsResult.status === 'fulfilled') {
      setAnalysisVersions(analysisVersionsResult.value);
    }
    if (architectureResult.status === 'fulfilled') {
      setArchitecture(architectureResult.value);
      const versionList = await architectureApi.getArchitectureVersions(projectId);
      setVersions(versionList);
    } else {
      setArchitecture(null);
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
      const result = await architectureApi.generateArchitecture(id);
      setArchitecture(result);
      const versionList = await architectureApi.getArchitectureVersions(id);
      setVersions(versionList);
    } catch (err) {
      setError(errorMessage(err, 'Architecture generation failed. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRegenerate = async () => {
    if (!id || working) return;
    if (
      !window.confirm(
        'Generate a fresh architecture from the latest Project Analysis? Previous architecture versions will be preserved.',
      )
    ) {
      return;
    }
    messageIndex.current = 0;
    setGeneratingMessage(GENERATING_MESSAGES[0]);
    setWorking(true);
    setError(null);
    try {
      const result = await architectureApi.regenerateArchitecture(id);
      setArchitecture(result);
      const versionList = await architectureApi.getArchitectureVersions(id);
      setVersions(versionList);
    } catch (err) {
      setError(errorMessage(err, 'Architecture regeneration failed. Please try again.'));
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
          <h1>Architecture</h1>
          <p className="page-subtitle">{project.name}</p>
        </div>
        {architecture && (
          <div className="project-detail-actions">
            <Link to={`/projects/${project.id}/architecture/edit`}>Edit Architecture</Link>
            <button type="button" onClick={handleRegenerate} disabled={working}>
              Regenerate Architecture
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

      {!working && !architecture && (
        <div className="empty-state">
          <p>This project doesn't have an architecture yet.</p>
          <p className="page-subtitle">
            Architecture is generated from your current Project Analysis. Make sure that's
            reviewed and ready first.
          </p>
          <button type="button" onClick={handleGenerate}>
            Generate Architecture
          </button>
        </div>
      )}

      {!working && architecture && (
        <>
          <p className="page-subtitle">
            Based on Project Analysis{' '}
            {analysisVersionFor(architecture.projectAnalysisId)
              ? `v${analysisVersionFor(architecture.projectAnalysisId)}`
              : '(version unavailable)'}
          </p>
          <ArchitectureMetadata
            architecture={architecture}
            analysisVersion={analysisVersionFor(architecture.projectAnalysisId)}
          />
          <ArchitectureContentView architecture={architecture} />

          {versions.length > 1 && (
            <section className="analysis-section">
              <h3>Version History</h3>
              <ul className="analysis-version-list">
                {versions.map((v) => (
                  <li key={v.id}>
                    {v.version === architecture.version ? (
                      <span>
                        Version {v.version} — {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'}{' '}
                        (current)
                      </span>
                    ) : (
                      <Link to={`/projects/${project.id}/architecture/versions/${v.version}`}>
                        Version {v.version} — {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'}
                        {v.source === 'AI_GENERATED' && analysisVersionFor(v.projectAnalysisId)
                          ? ` — based on Analysis v${analysisVersionFor(v.projectAnalysisId)}`
                          : ''}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
