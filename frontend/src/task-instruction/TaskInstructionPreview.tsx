import { useState } from 'react';
import axios from 'axios';
import { taskInstructionApi } from '../api/task-instruction.api';
import type { TaskInstruction } from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function shortSha(sha: string): string {
  return sha.slice(0, 10);
}

// Technical/admin-style preview only — no free-form editing (Task itself is
// the editable planning artifact; this is a generated execution artifact,
// see item 57) and deliberately no "Run Task" action (Sprint 12 owns
// execution). Lives inline on each Task card in the current Sprint Plan.
export function TaskInstructionPreview({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [instruction, setInstruction] = useState<TaskInstruction | null>(null);
  const [notGenerated, setNotGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFinal, setShowFinal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setNotGenerated(false);
    try {
      const current = await taskInstructionApi.getCurrent(projectId, taskId);
      setInstruction(current);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setNotGenerated(true);
        setInstruction(null);
      } else {
        setError(errorMessage(err, 'Could not load the instruction.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !instruction && !notGenerated) {
      void load();
    }
  };

  const handleGenerate = async () => {
    if (instruction && !instruction.stale) {
      if (!window.confirm('The current instruction still matches the latest repository state. Regenerate anyway?')) {
        return;
      }
    }
    setWorking(true);
    setError(null);
    try {
      const generated = await taskInstructionApi.generate(projectId, taskId);
      setInstruction(generated);
      setNotGenerated(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not generate the instruction.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="workspace-panel" style={{ marginTop: 8 }}>
      <div className="job-card-header">
        <button type="button" className="secondary" onClick={handleToggle}>
          {expanded ? 'Hide Execution Instruction' : 'Preview Execution Instruction'}
        </button>
        {instruction && (
          <span className={`status-badge status-badge--${instruction.stale ? 'paused' : 'success'}`}>
            v{instruction.version} · {instruction.stale ? 'Stale' : 'Current'}
          </span>
        )}
      </div>

      {expanded && (
        <>
          {loading && <p>Loading…</p>}
          {error && <p className="form-error">{error}</p>}
          {notGenerated && !loading && <p className="analysis-empty-section">No instruction generated yet.</p>}

          <button type="button" onClick={handleGenerate} disabled={working}>
            {instruction ? 'Regenerate Instruction' : 'Generate Instruction'}
          </button>

          {instruction && (
            <>
              <p className="approval-panel-meta">
                Generated against commit <code>{shortSha(instruction.repositoryHeadSha)}</code>
                {instruction.repositoryBranch && ` on ${instruction.repositoryBranch}`} · {instruction.provider}/
                {instruction.model} · {instruction.latencyMs}ms
              </p>

              <p className="approval-panel-meta">Objective:</p>
              <p>{instruction.objective}</p>

              <p className="approval-panel-meta">Implementation plan:</p>
              <ul className="analysis-card-list">
                {instruction.implementationPlan.map((step) => (
                  <li key={step.step}>
                    {step.step}. {step.description}
                    {step.likelyFiles && step.likelyFiles.length > 0 && (
                      <span className="approval-panel-meta"> ({step.likelyFiles.join(', ')})</span>
                    )}
                  </li>
                ))}
              </ul>

              <p className="approval-panel-meta">Acceptance criteria:</p>
              <ul className="analysis-card-list">
                {instruction.acceptanceCriteria.map((criterion, i) => (
                  <li key={i}>{criterion}</li>
                ))}
              </ul>

              <p className="approval-panel-meta">Validation plan:</p>
              <ul className="analysis-card-list">
                {instruction.validationPlan.map((item, i) => (
                  <li key={i}>
                    {item.type}
                    {item.required ? ' (required)' : ' (optional)'} — {item.description}
                  </li>
                ))}
              </ul>

              {instruction.constraints.length > 0 && (
                <>
                  <p className="approval-panel-meta">Constraints:</p>
                  <ul className="analysis-card-list">
                    {instruction.constraints.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}

              <button type="button" className="secondary" onClick={() => setShowFinal((v) => !v)}>
                {showFinal ? 'Hide Final Instruction' : 'View Final Instruction'}
              </button>
              {showFinal && <pre className="workspace-diff">{instruction.finalInstruction}</pre>}
            </>
          )}
        </>
      )}
    </div>
  );
}
