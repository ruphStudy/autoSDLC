import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { approvalApi } from '../api/approval.api';
import type { ApprovalSummary } from '../approval/types';
import { useExecutionMonitor } from '../execution-monitor/useExecutionMonitor';
import { ExecutionHeader } from '../execution-monitor/ExecutionHeader';
import { SprintProgressCard } from '../execution-monitor/SprintProgressCard';
import { CurrentTaskCard } from '../execution-monitor/CurrentTaskCard';
import { TaskPipeline } from '../execution-monitor/TaskPipeline';
import { AgentActivityCard } from '../execution-monitor/AgentActivityCard';
import { ValidationCard } from '../execution-monitor/ValidationCard';
import { GitChangesCard } from '../execution-monitor/GitChangesCard';
import { UsageCard } from '../execution-monitor/UsageCard';
import { ExecutionTimeline } from '../execution-monitor/ExecutionTimeline';

// The main operational surface for autonomous Sprint execution (item 35-37)
// — the user should be able to understand and control the whole
// Start -> code -> validate -> commit -> next Task -> Sprint complete loop
// from this one page, without reading terminal logs or the database.
export function DevelopmentPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id!;
  const [approvalSummary, setApprovalSummary] = useState<ApprovalSummary | null>(null);
  const { overview, loading, connectionWarning, refresh } = useExecutionMonitor(projectId);

  useEffect(() => {
    approvalApi
      .getSummary(projectId)
      .then(setApprovalSummary)
      .catch(() => setApprovalSummary(null));
  }, [projectId]);

  if (loading && !overview) {
    return <p>Loading…</p>;
  }

  if (!overview) {
    return <p className="form-error">Could not load the development dashboard.</p>;
  }

  const planApproved = approvalSummary?.sprintPlan.decision === 'APPROVED';
  const developmentApproved = approvalSummary?.startDevelopment.decision === 'APPROVED';

  return (
    <div className="analysis-content">
      <Link to={`/projects/${projectId}`} className="back-link">
        ← Back to project
      </Link>

      {connectionWarning && (
        <p className="approval-panel-meta">
          Having trouble reaching the server — showing the last known state.
        </p>
      )}

      {!developmentApproved || !planApproved ? (
        <section className="workspace-panel">
          <h3>Development</h3>
          <p>
            {!planApproved
              ? 'Sprint Plan approval is required before development can start.'
              : 'Development approval is required before development can start.'}
          </p>
          <Link to={`/projects/${projectId}/sprint-plan`}>Go to Sprint Plan</Link>
        </section>
      ) : overview.workspace.status !== 'READY' ? (
        <section className="workspace-panel">
          <h3>Development</h3>
          <p>Your approved Sprint Plan is ready for development. Prepare the workspace to begin.</p>
          <Link to={`/projects/${projectId}`}>Go to Workspace</Link>
        </section>
      ) : (
        <>
          <ExecutionHeader projectId={projectId} overview={overview} onChanged={refresh} />

          {!overview.hasActiveExecution && !overview.activeSprintExecution && (
            <section className="workspace-panel">
              <p>
                {overview.nextSprintEligible
                  ? `Sprint ${overview.nextSprintEligible.number} is ready to start.`
                  : 'No Sprint is currently eligible to run.'}
              </p>
            </section>
          )}

          <SprintProgressCard
            sprints={overview.sprintProgress}
            activeSprintId={overview.activeSprintExecution?.sprintId ?? null}
          />

          {overview.activeSprintExecution && overview.activeSprintExecution.tasks.length > 0 && (
            <TaskPipeline
              tasks={overview.activeSprintExecution.tasks}
              currentTaskId={overview.activeSprintExecution.currentTaskId}
            />
          )}

          <CurrentTaskCard task={overview.currentTask} />
          <AgentActivityCard agent={overview.agent} />
          <ValidationCard validation={overview.validation} />

          {overview.activeSprintExecution?.status === 'COMPLETED' && (
            <section className="analysis-empty-section">
              Sprint completed successfully. {overview.activeSprintExecution.passedTasks} /{' '}
              {overview.activeSprintExecution.totalTasks} Tasks passed. Final commit:{' '}
              <code>{overview.activeSprintExecution.repositoryEndSha?.slice(0, 10)}</code>.
            </section>
          )}
          {overview.activeSprintExecution?.status === 'BLOCKED' && (
            <p className="form-error">
              Blocked — {overview.activeSprintExecution.errorMessage ?? 'no Task is runnable.'}
            </p>
          )}

          <GitChangesCard workspace={overview.workspace} commits={overview.recentCommits} />
          <UsageCard usage={overview.usage} />
          <ExecutionTimeline projectId={projectId} events={overview.recentEvents} />
        </>
      )}
    </div>
  );
}
