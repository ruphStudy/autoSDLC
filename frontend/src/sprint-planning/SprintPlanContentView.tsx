import type { SprintPlan, Task } from './types';

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="analysis-tag-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <li className="analysis-card">
      <div className="analysis-card-header">
        <strong>
          {task.key} — {task.title}
        </strong>
        <span className="analysis-card-meta">{task.status}</span>
      </div>
      <p>{task.description}</p>

      {task.dependsOnTaskKeys.length > 0 && (
        <p className="analysis-card-meta">Depends on: {task.dependsOnTaskKeys.join(', ')}</p>
      )}

      <p className="analysis-card-meta">Acceptance criteria:</p>
      <ul className="analysis-card-list">
        {task.acceptanceCriteria.map((criterion, i) => (
          <li key={i}>{criterion}</li>
        ))}
      </ul>

      <p className="analysis-card-meta">Validation:</p>
      <ul className="analysis-card-list">
        {task.validationExpectations.map((expectation, i) => (
          <li key={i}>
            {expectation.type}
            {expectation.required ? ' (required)' : ' (optional)'} — {expectation.description}
          </li>
        ))}
      </ul>

      {task.requirementIds.length > 0 && (
        <>
          <p className="analysis-card-meta">Requirements:</p>
          <Chips items={task.requirementIds} />
        </>
      )}
      {task.architectureAreas.length > 0 && (
        <>
          <p className="analysis-card-meta">Architecture areas:</p>
          <Chips items={task.architectureAreas} />
        </>
      )}
    </li>
  );
}

export function SprintPlanContentView({ plan }: { plan: SprintPlan }) {
  return (
    <div className="analysis-content">
      <section className="analysis-section">
        <h3>Summary</h3>
        <p>{plan.summary}</p>
      </section>

      <section className="analysis-section">
        <h3>Strategy</h3>
        <p>{plan.strategy}</p>
      </section>

      {plan.sprints
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((sprint) => (
          <section className="analysis-section" key={sprint.id}>
            <div className="analysis-card-header">
              <h3>
                Sprint {sprint.number} — {sprint.title}
              </h3>
              <span className="analysis-card-meta">{sprint.status}</span>
            </div>
            <p>{sprint.objective}</p>
            {sprint.description && <p className="analysis-card-meta">{sprint.description}</p>}
            {sprint.dependsOnSprintNumbers.length > 0 && (
              <p className="analysis-card-meta">
                Depends on sprint{sprint.dependsOnSprintNumbers.length > 1 ? 's' : ''}:{' '}
                {sprint.dependsOnSprintNumbers.join(', ')}
              </p>
            )}
            <ul className="analysis-card-list">
              {sprint.tasks
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
