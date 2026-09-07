import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sprintPlanningApi } from '../api/sprint-planning.api';
import { ListEditor } from '../project-analysis/ListEditor';
import type {
  SprintEditPayload,
  SprintPlan,
  SprintPlanEditPayload,
  TaskEditPayload,
  ValidationExpectation,
  ValidationExpectationType,
} from '../sprint-planning/types';

const VALIDATION_TYPES: ValidationExpectationType[] = [
  'lint',
  'typecheck',
  'unit_test',
  'integration_test',
  'e2e_test',
  'build',
  'manual',
  'other',
];

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function toList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function CommaListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return (
    <>
      <label>{label} (comma-separated)</label>
      <input
        type="text"
        value={value.join(', ')}
        placeholder={placeholder}
        onChange={(e) => onChange(toList(e.target.value))}
      />
    </>
  );
}

// Lists eligible dependency targets by natural key (sprint number / task key)
// rather than raw database ids, matching how the backend resolves them.
function DependencyMultiSelect<T extends string | number>({
  label,
  available,
  selected,
  onChange,
  format,
}: {
  label: string;
  available: T[];
  selected: T[];
  onChange: (next: T[]) => void;
  format: (value: T) => string;
}) {
  const toggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };
  return (
    <div className="dependency-select">
      <span>{label}</span>
      {available.length === 0 ? (
        <p className="analysis-empty-section">No eligible dependencies yet.</p>
      ) : (
        <div className="dependency-select-options">
          {available.map((value) => (
            <label key={String(value)} className="analysis-inline-checkbox">
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => toggle(value)}
              />
              {format(value)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function fromSprintPlan(plan: SprintPlan): SprintPlanEditPayload {
  return {
    summary: plan.summary,
    strategy: plan.strategy,
    sprints: plan.sprints
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((sprint) => ({
        number: sprint.number,
        title: sprint.title,
        objective: sprint.objective,
        description: sprint.description ?? undefined,
        dependencies: sprint.dependsOnSprintNumbers,
        tasks: sprint.tasks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((task) => ({
            key: task.key,
            title: task.title,
            description: task.description,
            dependencies: task.dependsOnTaskKeys,
            acceptanceCriteria: task.acceptanceCriteria,
            validationExpectations: task.validationExpectations,
            requirementIds: task.requirementIds,
            architectureAreas: task.architectureAreas,
          })),
      })),
  };
}

export function EditSprintPlanPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState<SprintPlanEditPayload | null>(null);

  useEffect(() => {
    if (!id) return;
    sprintPlanningApi
      .getSprintPlan(id)
      .then((plan) => setContent(fromSprintPlan(plan)))
      .catch(() => setError('This sprint plan could not be loaded.'));
  }, [id]);

  const update = <K extends keyof SprintPlanEditPayload>(
    key: K,
    value: SprintPlanEditPayload[K],
  ) => setContent((prev) => (prev ? { ...prev, [key]: value } : prev));

  const updateSprints = (sprints: SprintEditPayload[]) => update('sprints', sprints);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || submitting || !content) return;
    setSubmitting(true);
    setError(null);
    try {
      await sprintPlanningApi.updateSprintPlan(id, content);
      navigate(`/projects/${id}/sprint-plan`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to save changes. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !content) {
    return (
      <div>
        <p className="form-error">{error}</p>
        <Link to={`/projects/${id}/sprint-plan`}>Back to sprint plan</Link>
      </div>
    );
  }

  if (!content) {
    return <p>Loading…</p>;
  }

  const allTaskKeys = content.sprints.flatMap((s) => s.tasks.map((t) => t.key));
  const allSprintNumbers = content.sprints.map((s) => s.number);

  return (
    <div className="form-page form-page--wide">
      <h1>Edit Sprint Plan</h1>

      <form className="project-form" onSubmit={handleSubmit}>
        <label htmlFor="summary">Summary</label>
        <textarea
          id="summary"
          rows={3}
          value={content.summary}
          onChange={(e) => update('summary', e.target.value)}
        />

        <label htmlFor="strategy">Strategy</label>
        <textarea
          id="strategy"
          rows={3}
          value={content.strategy}
          onChange={(e) => update('strategy', e.target.value)}
        />

        <fieldset className="analysis-edit-section">
          <legend>Sprints</legend>
          {content.sprints.length === 0 && (
            <p className="analysis-empty-section">No sprints yet.</p>
          )}
          {content.sprints.map((sprint, sprintIndex) => {
            const updateSprint = (patch: Partial<SprintEditPayload>) => {
              updateSprints(
                content.sprints.map((s, i) => (i === sprintIndex ? { ...s, ...patch } : s)),
              );
            };
            const removeSprint = () => {
              updateSprints(content.sprints.filter((_, i) => i !== sprintIndex));
            };
            const eligibleSprintDeps = allSprintNumbers.filter((n) => n < sprint.number);
            const eligibleTaskDeps = allTaskKeys.filter(
              (key) => !sprint.tasks.some((t) => t.key === key),
            );

            return (
              <div className="sprint-edit-card" key={sprintIndex}>
                <div className="sprint-edit-card-header">
                  <label>
                    Sprint #
                    <input
                      type="number"
                      min={1}
                      value={sprint.number}
                      onChange={(e) => updateSprint({ number: Number(e.target.value) })}
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Title"
                    value={sprint.title}
                    onChange={(e) => updateSprint({ title: e.target.value })}
                  />
                  <button type="button" className="secondary" onClick={removeSprint}>
                    Remove sprint
                  </button>
                </div>

                <label>Objective</label>
                <textarea
                  rows={2}
                  value={sprint.objective}
                  onChange={(e) => updateSprint({ objective: e.target.value })}
                />
                <label>Description</label>
                <textarea
                  rows={2}
                  value={sprint.description ?? ''}
                  onChange={(e) => updateSprint({ description: e.target.value || undefined })}
                />

                <DependencyMultiSelect<number>
                  label="Depends on sprints (earlier sprints only)"
                  available={eligibleSprintDeps}
                  selected={sprint.dependencies}
                  onChange={(dependencies) => updateSprint({ dependencies })}
                  format={(n) => `Sprint ${n}`}
                />

                <ListEditor<TaskEditPayload>
                  title="Tasks"
                  items={sprint.tasks}
                  onChange={(tasks) => updateSprint({ tasks })}
                  createItem={() => ({
                    key: `S${sprint.number}-T${sprint.tasks.length + 1}`,
                    title: '',
                    description: '',
                    dependencies: [],
                    acceptanceCriteria: [],
                    validationExpectations: [
                      { type: 'unit_test', description: '', required: true },
                    ],
                    requirementIds: [],
                    architectureAreas: [],
                  })}
                  renderItem={(task, updateTask) => (
                    <div className="task-edit-fields">
                      <input
                        type="text"
                        placeholder="Key (e.g. S1-T1)"
                        value={task.key}
                        onChange={(e) => updateTask({ key: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Title"
                        value={task.title}
                        onChange={(e) => updateTask({ title: e.target.value })}
                      />
                      <textarea
                        rows={2}
                        placeholder="Description"
                        value={task.description}
                        onChange={(e) => updateTask({ description: e.target.value })}
                      />
                      <DependencyMultiSelect<string>
                        label="Depends on tasks"
                        available={eligibleTaskDeps.filter((key) => key !== task.key)}
                        selected={task.dependencies}
                        onChange={(dependencies) => updateTask({ dependencies })}
                        format={(key) => key}
                      />
                      <CommaListField
                        label="Acceptance criteria"
                        value={task.acceptanceCriteria}
                        onChange={(acceptanceCriteria) => updateTask({ acceptanceCriteria })}
                      />
                      <CommaListField
                        label="Requirement IDs"
                        value={task.requirementIds}
                        placeholder="FR-001, FR-002"
                        onChange={(requirementIds) => updateTask({ requirementIds })}
                      />
                      <CommaListField
                        label="Architecture areas"
                        value={task.architectureAreas}
                        onChange={(architectureAreas) => updateTask({ architectureAreas })}
                      />
                      <ListEditor<ValidationExpectation>
                        title="Validation expectations"
                        items={task.validationExpectations}
                        onChange={(validationExpectations) =>
                          updateTask({ validationExpectations })
                        }
                        createItem={() => ({ type: 'unit_test', description: '', required: true })}
                        renderItem={(expectation, updateExpectation) => (
                          <>
                            <select
                              value={expectation.type}
                              onChange={(e) =>
                                updateExpectation({
                                  type: e.target.value as ValidationExpectationType,
                                })
                              }
                            >
                              {VALIDATION_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              placeholder="Description"
                              value={expectation.description}
                              onChange={(e) => updateExpectation({ description: e.target.value })}
                            />
                            <label className="analysis-inline-checkbox">
                              <input
                                type="checkbox"
                                checked={expectation.required}
                                onChange={(e) =>
                                  updateExpectation({ required: e.target.checked })
                                }
                              />
                              Required
                            </label>
                          </>
                        )}
                      />
                    </div>
                  )}
                />
              </div>
            );
          })}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              updateSprints([
                ...content.sprints,
                {
                  number: content.sprints.length + 1,
                  title: '',
                  objective: '',
                  dependencies: [],
                  tasks: [],
                },
              ])
            }
          >
            Add sprint
          </button>
        </fieldset>

        {error && <p className="form-error">{error}</p>}

        <div className="project-form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/projects/${id}/sprint-plan`)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
