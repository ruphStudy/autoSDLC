import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { projectAnalysisApi } from '../api/project-analysis.api';
import { projectsApi } from '../api/projects.api';
import { AnalysisContentView } from '../project-analysis/AnalysisContentView';
import { AnalysisMetadata } from '../project-analysis/AnalysisMetadata';
import type { AnalysisVersionSummary, ProjectAnalysis } from '../project-analysis/types';
import type { Project } from '../projects/types';

const ANALYZING_MESSAGES = [
  'Reviewing project brief…',
  'Identifying target users and goals…',
  'Structuring requirements…',
];

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

export function ProjectAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [versions, setVersions] = useState<AnalysisVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [analyzingMessage, setAnalyzingMessage] = useState(ANALYZING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);
  const messageIndex = useRef(0);

  const load = async (projectId: string) => {
    const [projectResult, analysisResult] = await Promise.allSettled([
      projectsApi.getProject(projectId),
      projectAnalysisApi.getProjectAnalysis(projectId),
    ]);

    if (projectResult.status === 'fulfilled') {
      setProject(projectResult.value);
    }
    if (analysisResult.status === 'fulfilled') {
      setAnalysis(analysisResult.value);
      const versionList = await projectAnalysisApi.getProjectAnalysisVersions(projectId);
      setVersions(versionList);
    } else {
      setAnalysis(null);
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
      messageIndex.current = (messageIndex.current + 1) % ANALYZING_MESSAGES.length;
      setAnalyzingMessage(ANALYZING_MESSAGES[messageIndex.current]);
    }, 2500);
    return () => clearInterval(interval);
  }, [working]);

  const handleGenerate = async () => {
    if (!id || working) return;
    messageIndex.current = 0;
    setAnalyzingMessage(ANALYZING_MESSAGES[0]);
    setWorking(true);
    setError(null);
    try {
      const result = await projectAnalysisApi.generateProjectAnalysis(id);
      setAnalysis(result);
      const versionList = await projectAnalysisApi.getProjectAnalysisVersions(id);
      setVersions(versionList);
      const refreshedProject = await projectsApi.getProject(id);
      setProject(refreshedProject);
    } catch (err) {
      setError(errorMessage(err, 'Analysis generation failed. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRegenerate = async () => {
    if (!id || working) return;
    if (
      !window.confirm(
        'Generate a fresh AI analysis? Your current version and its history will be preserved, but this creates a new version rather than merging any manual edits.',
      )
    ) {
      return;
    }
    messageIndex.current = 0;
    setAnalyzingMessage(ANALYZING_MESSAGES[0]);
    setWorking(true);
    setError(null);
    try {
      const result = await projectAnalysisApi.regenerateProjectAnalysis(id);
      setAnalysis(result);
      const versionList = await projectAnalysisApi.getProjectAnalysisVersions(id);
      setVersions(versionList);
    } catch (err) {
      setError(errorMessage(err, 'Analysis regeneration failed. Please try again.'));
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
          <h1>Project Analysis</h1>
          <p className="page-subtitle">{project.name}</p>
        </div>
        {analysis && (
          <div className="project-detail-actions">
            <Link to={`/projects/${project.id}/analysis/edit`}>Edit Analysis</Link>
            <button type="button" onClick={handleRegenerate} disabled={working}>
              Regenerate Analysis
            </button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {working && (
        <div className="analyzing-state">
          <p>{analyzingMessage}</p>
        </div>
      )}

      {!working && !analysis && (
        <div className="empty-state">
          <p>This project hasn't been analyzed yet.</p>
          <button type="button" onClick={handleGenerate}>
            Analyze Project
          </button>
        </div>
      )}

      {!working && analysis && (
        <>
          <AnalysisMetadata analysis={analysis} />
          <AnalysisContentView analysis={analysis} />

          {versions.length > 1 && (
            <section className="analysis-section">
              <h3>Version History</h3>
              <ul className="analysis-version-list">
                {versions.map((v) => (
                  <li key={v.id}>
                    {v.version === analysis.version ? (
                      <span>
                        Version {v.version} — {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'}{' '}
                        (current)
                      </span>
                    ) : (
                      <Link to={`/projects/${project.id}/analysis/versions/${v.version}`}>
                        Version {v.version} — {v.source === 'AI_GENERATED' ? 'AI Generated' : 'User Edited'}
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
