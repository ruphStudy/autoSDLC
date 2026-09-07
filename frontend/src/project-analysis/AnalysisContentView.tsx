import { ImportanceBadge, PriorityBadge } from './badges';
import type { ProjectAnalysis } from './types';

function Empty({ children }: { children: string }) {
  return <p className="analysis-empty-section">{children}</p>;
}

export function AnalysisContentView({ analysis }: { analysis: ProjectAnalysis }) {
  return (
    <div className="analysis-content">
      <section className="analysis-section">
        <h3>Product Summary</h3>
        <p>{analysis.summary}</p>
      </section>

      <section className="analysis-section">
        <h3>Target Users</h3>
        {analysis.targetUsers.length === 0 ? (
          <Empty>No target users identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.targetUsers.map((user, i) => (
              <li key={i} className="analysis-card">
                <strong>{user.name}</strong>
                <p>{user.description}</p>
                {user.needs.length > 0 && (
                  <ul className="analysis-tag-list">
                    {user.needs.map((need, j) => (
                      <li key={j}>{need}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Goals</h3>
        {analysis.goals.length === 0 ? (
          <Empty>No goals identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.goals.map((goal, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{goal.title}</strong>
                  {goal.priority && <ImportanceBadge level={goal.priority} />}
                </div>
                <p>{goal.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Features</h3>
        {analysis.features.length === 0 ? (
          <Empty>No features identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.features.map((feature, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{feature.name}</strong>
                  <PriorityBadge priority={feature.priority} />
                </div>
                <p>{feature.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Functional Requirements</h3>
        {analysis.functionalRequirements.length === 0 ? (
          <Empty>No functional requirements identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.functionalRequirements.map((req) => (
              <li key={req.id} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>
                    {req.id} — {req.title}
                  </strong>
                  <PriorityBadge priority={req.priority} />
                </div>
                <p>{req.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Non-Functional Requirements</h3>
        {analysis.nonFunctionalRequirements.length === 0 ? (
          <Empty>No non-functional requirements identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.nonFunctionalRequirements.map((req, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{req.category}</strong>
                  {req.priority && <ImportanceBadge level={req.priority} />}
                </div>
                <p>{req.requirement}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Assumptions</h3>
        {analysis.assumptions.length === 0 ? (
          <Empty>No assumptions recorded.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.assumptions.map((item, i) => (
              <li key={i} className="analysis-card">
                <p>{item.assumption}</p>
                {item.impact && <p className="analysis-card-meta">Impact: {item.impact}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Risks</h3>
        {analysis.risks.length === 0 ? (
          <Empty>No risks identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.risks.map((item, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{item.risk}</strong>
                  <ImportanceBadge level={item.severity} />
                </div>
                {item.mitigation && <p className="analysis-card-meta">Mitigation: {item.mitigation}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section analysis-section--highlight">
        <h3>Unresolved Questions</h3>
        {analysis.unresolvedQuestions.length === 0 ? (
          <Empty>No unresolved questions — the brief was unambiguous.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.unresolvedQuestions.map((item, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{item.question}</strong>
                  <ImportanceBadge level={item.importance} />
                </div>
                {item.reason && <p className="analysis-card-meta">{item.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Integrations</h3>
        {analysis.integrations.length === 0 ? (
          <Empty>No integrations identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {analysis.integrations.map((item, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{item.name}</strong>
                  <span className="analysis-card-meta">{item.required ? 'Required' : 'Optional'}</span>
                </div>
                <p>{item.purpose}</p>
                {item.notes && <p className="analysis-card-meta">{item.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
