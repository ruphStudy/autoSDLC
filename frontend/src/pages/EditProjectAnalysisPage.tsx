import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectAnalysisApi } from '../api/project-analysis.api';
import { ListEditor } from '../project-analysis/ListEditor';
import type {
  Assumption,
  Feature,
  FunctionalRequirement,
  Goal,
  ImportanceLevel,
  Integration,
  MoscowPriority,
  NonFunctionalRequirement,
  ProjectAnalysis,
  Risk,
  TargetUser,
  UnresolvedQuestion,
} from '../project-analysis/types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function MoscowSelect({
  value,
  onChange,
}: {
  value: MoscowPriority;
  onChange: (value: MoscowPriority) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as MoscowPriority)}>
      <option value="must_have">Must have</option>
      <option value="should_have">Should have</option>
      <option value="could_have">Could have</option>
    </select>
  );
}

function ImportanceSelect({
  value,
  onChange,
  allowUnset = false,
}: {
  value: ImportanceLevel | undefined;
  onChange: (value: ImportanceLevel | undefined) => void;
  allowUnset?: boolean;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as ImportanceLevel | undefined)}
    >
      {allowUnset && <option value="">—</option>}
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>
  );
}

export function EditProjectAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<ProjectAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [summary, setSummary] = useState('');
  const [targetUsers, setTargetUsers] = useState<TargetUser[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [functionalRequirements, setFunctionalRequirements] = useState<FunctionalRequirement[]>([]);
  const [nonFunctionalRequirements, setNonFunctionalRequirements] = useState<
    NonFunctionalRequirement[]
  >([]);
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [unresolvedQuestions, setUnresolvedQuestions] = useState<UnresolvedQuestion[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  useEffect(() => {
    if (!id) return;
    projectAnalysisApi
      .getProjectAnalysis(id)
      .then((analysis) => {
        setLoaded(analysis);
        setSummary(analysis.summary);
        setTargetUsers(analysis.targetUsers);
        setGoals(analysis.goals);
        setFeatures(analysis.features);
        setFunctionalRequirements(analysis.functionalRequirements);
        setNonFunctionalRequirements(analysis.nonFunctionalRequirements);
        setAssumptions(analysis.assumptions);
        setRisks(analysis.risks);
        setUnresolvedQuestions(analysis.unresolvedQuestions);
        setIntegrations(analysis.integrations);
      })
      .catch(() => setError('This analysis could not be loaded.'));
  }, [id]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await projectAnalysisApi.updateProjectAnalysis(id, {
        summary,
        targetUsers,
        goals,
        features,
        functionalRequirements,
        nonFunctionalRequirements,
        assumptions,
        risks,
        unresolvedQuestions,
        integrations,
      });
      navigate(`/projects/${id}/analysis`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to save changes. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !loaded) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to={`/projects/${id}/analysis`}>Back to analysis</Link>
      </div>
    );
  }

  if (!loaded) {
    return <p>Loading…</p>;
  }

  return (
    <div className="form-page form-page--wide">
      <h1>Edit Analysis</h1>

      <form className="project-form" onSubmit={handleSubmit}>
        <label htmlFor="summary">Product Summary</label>
        <textarea id="summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />

        <ListEditor<TargetUser>
          title="Target Users"
          items={targetUsers}
          onChange={setTargetUsers}
          createItem={() => ({ name: '', description: '', needs: [] })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Name"
                value={item.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              <input
                type="text"
                placeholder="Needs (comma-separated)"
                value={item.needs.join(', ')}
                onChange={(e) =>
                  update({
                    needs: e.target.value
                      .split(',')
                      .map((n) => n.trim())
                      .filter(Boolean),
                  })
                }
              />
            </>
          )}
        />

        <ListEditor<Goal>
          title="Goals"
          items={goals}
          onChange={setGoals}
          createItem={() => ({ title: '', description: '' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Title"
                value={item.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              <ImportanceSelect
                value={item.priority}
                onChange={(priority) => update({ priority })}
                allowUnset
              />
            </>
          )}
        />

        <ListEditor<Feature>
          title="Features"
          items={features}
          onChange={setFeatures}
          createItem={() => ({ name: '', description: '', priority: 'must_have' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Name"
                value={item.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              <MoscowSelect value={item.priority} onChange={(priority) => update({ priority })} />
            </>
          )}
        />

        <ListEditor<FunctionalRequirement>
          title="Functional Requirements"
          items={functionalRequirements}
          onChange={setFunctionalRequirements}
          createItem={() => ({
            id: `FR-${String(functionalRequirements.length + 1).padStart(3, '0')}`,
            title: '',
            description: '',
            priority: 'must_have',
          })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="ID (e.g. FR-001)"
                value={item.id}
                onChange={(e) => update({ id: e.target.value })}
              />
              <input
                type="text"
                placeholder="Title"
                value={item.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              <MoscowSelect value={item.priority} onChange={(priority) => update({ priority })} />
            </>
          )}
        />

        <ListEditor<NonFunctionalRequirement>
          title="Non-Functional Requirements"
          items={nonFunctionalRequirements}
          onChange={setNonFunctionalRequirements}
          createItem={() => ({ category: '', requirement: '' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Category (e.g. performance)"
                value={item.category}
                onChange={(e) => update({ category: e.target.value })}
              />
              <input
                type="text"
                placeholder="Requirement"
                value={item.requirement}
                onChange={(e) => update({ requirement: e.target.value })}
              />
              <ImportanceSelect
                value={item.priority}
                onChange={(priority) => update({ priority })}
                allowUnset
              />
            </>
          )}
        />

        <ListEditor<Assumption>
          title="Assumptions"
          items={assumptions}
          onChange={setAssumptions}
          createItem={() => ({ assumption: '' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Assumption"
                value={item.assumption}
                onChange={(e) => update({ assumption: e.target.value })}
              />
              <input
                type="text"
                placeholder="Impact (optional)"
                value={item.impact ?? ''}
                onChange={(e) => update({ impact: e.target.value || undefined })}
              />
            </>
          )}
        />

        <ListEditor<Risk>
          title="Risks"
          items={risks}
          onChange={setRisks}
          createItem={() => ({ risk: '', severity: 'medium' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Risk"
                value={item.risk}
                onChange={(e) => update({ risk: e.target.value })}
              />
              <ImportanceSelect value={item.severity} onChange={(severity) => update({ severity })} />
              <input
                type="text"
                placeholder="Mitigation (optional)"
                value={item.mitigation ?? ''}
                onChange={(e) => update({ mitigation: e.target.value || undefined })}
              />
            </>
          )}
        />

        <ListEditor<UnresolvedQuestion>
          title="Unresolved Questions"
          items={unresolvedQuestions}
          onChange={setUnresolvedQuestions}
          createItem={() => ({ question: '', importance: 'medium' })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Question"
                value={item.question}
                onChange={(e) => update({ question: e.target.value })}
              />
              <ImportanceSelect
                value={item.importance}
                onChange={(importance) => update({ importance })}
              />
              <input
                type="text"
                placeholder="Reason (optional)"
                value={item.reason ?? ''}
                onChange={(e) => update({ reason: e.target.value || undefined })}
              />
            </>
          )}
        />

        <ListEditor<Integration>
          title="Integrations"
          items={integrations}
          onChange={setIntegrations}
          createItem={() => ({ name: '', purpose: '', required: true })}
          renderItem={(item, update) => (
            <>
              <input
                type="text"
                placeholder="Name"
                value={item.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Purpose"
                value={item.purpose}
                onChange={(e) => update({ purpose: e.target.value })}
              />
              <label className="analysis-inline-checkbox">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={(e) => update({ required: e.target.checked })}
                />
                Required
              </label>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={item.notes ?? ''}
                onChange={(e) => update({ notes: e.target.value || undefined })}
              />
            </>
          )}
        />

        {error && <p className="form-error">{error}</p>}

        <div className="project-form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/projects/${id}/analysis`)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
