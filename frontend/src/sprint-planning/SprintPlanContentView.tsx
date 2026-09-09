import type { SprintPlan, Task } from './types';
import { TaskInstructionPreview } from '../task-instruction/TaskInstructionPreview';
import { TaskExecutionPanel } from '../task-execution/TaskExecutionPanel';
import { TaskValidationPanel } from '../task-validation/TaskValidationPanel';

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

function TaskCard({
  task,
  projectId,
  canPreviewInstructions,
  canRunTasks,
}: {
  task: Task;
  projectId: string;
  canPreviewInstructions: boolean;
  canRunTasks: boolean;
}) {
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

      {canPreviewInstructions && <TaskInstructionPreview projectId={projectId} taskId={task.id} />}
      {canRunTasks && (
        <>
          <TaskExecutionPanel projectId={projectId} taskId={task.id} taskStatus={task.status} />
          <TaskValidationPanel projectId={projectId} taskId={task.id} />
        </>
      )}
    </li>
  );
}

export function SprintPlanContentView({
  plan,
  canPreviewInstructions = false,
  canRunTasks = false,
}: {
  plan: SprintPlan;
  // Only meaningful on the current plan page — a historical version's Tasks
  // belong to a superseded plan and can never have an instruction generated
  // for them (see TASK_NOT_IN_CURRENT_PLAN), so SprintPlanVersionPage leaves
  // this false.
  canPreviewInstructions?: boolean;
  // Same reasoning as canPreviewInstructions — a Task execution also
  // requires the Task to belong to the current Sprint Plan.
  canRunTasks?: boolean;
}) {
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
                  <TaskCard
                    key={task.id}
                    task={task}
                    projectId={plan.projectId}
                    canPreviewInstructions={canPreviewInstructions}
                    canRunTasks={canRunTasks}
                  />
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
