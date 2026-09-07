import type { Architecture } from './types';

function Empty({ children }: { children: string }) {
  return <p className="analysis-empty-section">{children}</p>;
}

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

export function ArchitectureContentView({ architecture: a }: { architecture: Architecture }) {
  return (
    <div className="analysis-content">
      <section className="analysis-section">
        <h3>Architecture Summary</h3>
        <p>{a.summary}</p>
      </section>

      <section className="analysis-section">
        <h3>Frontend</h3>
        <div className="analysis-card">
          <p>
            <strong>{a.frontendArchitecture.framework}</strong> ({a.frontendArchitecture.language})
          </p>
          <p>{a.frontendArchitecture.componentStrategy}</p>
          <dl className="arch-fact-list">
            {a.frontendArchitecture.renderingStrategy && (
              <>
                <dt>Rendering</dt>
                <dd>{a.frontendArchitecture.renderingStrategy}</dd>
              </>
            )}
            {a.frontendArchitecture.stateManagement && (
              <>
                <dt>State management</dt>
                <dd>{a.frontendArchitecture.stateManagement}</dd>
              </>
            )}
            {a.frontendArchitecture.routing && (
              <>
                <dt>Routing</dt>
                <dd>{a.frontendArchitecture.routing}</dd>
              </>
            )}
            {a.frontendArchitecture.styling && (
              <>
                <dt>Styling</dt>
                <dd>{a.frontendArchitecture.styling}</dd>
              </>
            )}
          </dl>
          <Chips items={a.frontendArchitecture.keyLibraries} />
        </div>
      </section>

      <section className="analysis-section">
        <h3>Backend</h3>
        <div className="analysis-card">
          <p>
            <strong>{a.backendArchitecture.framework}</strong> ({a.backendArchitecture.language}) —{' '}
            {a.backendArchitecture.architecturalStyle}
          </p>
          {a.backendArchitecture.modules.length === 0 ? (
            <Empty>No modules identified.</Empty>
          ) : (
            <ul className="analysis-card-list">
              {a.backendArchitecture.modules.map((m, i) => (
                <li key={i} className="analysis-card">
                  <strong>{m.name}</strong>
                  <p>{m.responsibility}</p>
                </li>
              ))}
            </ul>
          )}
          <Chips items={a.backendArchitecture.keyLibraries} />
        </div>
      </section>

      <section className="analysis-section">
        <h3>API</h3>
        <div className="analysis-card">
          <p>
            <strong>Style:</strong> {a.apiArchitecture.style}
          </p>
          {a.apiArchitecture.majorResourceGroups.length === 0 ? (
            <Empty>No major resource groups identified.</Empty>
          ) : (
            <ul className="analysis-card-list">
              {a.apiArchitecture.majorResourceGroups.map((g, i) => (
                <li key={i} className="analysis-card">
                  <strong>{g.name}</strong>
                  <p>{g.purpose}</p>
                </li>
              ))}
            </ul>
          )}
          <Chips items={a.apiArchitecture.conventions} />
        </div>
      </section>

      <section className="analysis-section">
        <h3>Database</h3>
        <div className="analysis-card">
          <p>
            <strong>{a.databaseArchitecture.technology}</strong> ({a.databaseArchitecture.databaseType})
          </p>
          <p>{a.databaseArchitecture.rationale}</p>
          {a.databaseArchitecture.majorEntities.length === 0 ? (
            <Empty>No major entities identified.</Empty>
          ) : (
            <ul className="analysis-card-list">
              {a.databaseArchitecture.majorEntities.map((e, i) => (
                <li key={i} className="analysis-card">
                  <strong>{e.name}</strong>
                  <p>{e.purpose}</p>
                  <Chips items={e.relationships} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="analysis-section">
        <h3>Authentication &amp; Authorization</h3>
        <div className="analysis-card">
          <p>
            <strong>{a.authenticationArchitecture.authenticationMethod}</strong>
          </p>
          <p>{a.authenticationArchitecture.tokenOrSessionStrategy}</p>
          <p>{a.authenticationArchitecture.authorizationModel}</p>
          <Chips items={a.authenticationArchitecture.roles} />
        </div>
      </section>

      <section className="analysis-section">
        <h3>Integrations</h3>
        {a.integrationArchitecture.length === 0 ? (
          <Empty>No integrations identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.integrationArchitecture.map((item, i) => (
              <li key={i} className="analysis-card">
                <div className="analysis-card-header">
                  <strong>{item.name}</strong>
                  <span className="analysis-card-meta">{item.direction}</span>
                </div>
                <p>{item.purpose}</p>
                {item.failureStrategy && (
                  <p className="analysis-card-meta">On failure: {item.failureStrategy}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Infrastructure</h3>
        <div className="analysis-card">
          <Chips items={a.infrastructureArchitecture.runtimeComponents} />
          <dl className="arch-fact-list">
            {a.infrastructureArchitecture.compute && (
              <>
                <dt>Compute</dt>
                <dd>{a.infrastructureArchitecture.compute}</dd>
              </>
            )}
            {a.infrastructureArchitecture.database && (
              <>
                <dt>Database</dt>
                <dd>{a.infrastructureArchitecture.database}</dd>
              </>
            )}
            {a.infrastructureArchitecture.cache && (
              <>
                <dt>Cache</dt>
                <dd>{a.infrastructureArchitecture.cache}</dd>
              </>
            )}
            {a.infrastructureArchitecture.queue && (
              <>
                <dt>Queue</dt>
                <dd>{a.infrastructureArchitecture.queue}</dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section className="analysis-section">
        <h3>Deployment</h3>
        <div className="analysis-card">
          <p>{a.deploymentArchitecture.deploymentStrategy}</p>
          <dl className="arch-fact-list">
            <dt>Environments</dt>
            <dd>{a.deploymentArchitecture.environments.join(', ') || '—'}</dd>
            <dt>CI/CD</dt>
            <dd>{a.deploymentArchitecture.ciCdApproach}</dd>
            <dt>Configuration</dt>
            <dd>{a.deploymentArchitecture.configurationStrategy}</dd>
            <dt>Secrets</dt>
            <dd>{a.deploymentArchitecture.secretsStrategy}</dd>
          </dl>
        </div>
      </section>

      <section className="analysis-section">
        <h3>Security</h3>
        {a.securityArchitecture.controls.length === 0 ? (
          <Empty>No security controls identified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.securityArchitecture.controls.map((c, i) => (
              <li key={i} className="analysis-card">
                <strong>{c.area}</strong>
                <p>{c.recommendation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Testing Strategy</h3>
        <div className="analysis-card">
          <dl className="arch-fact-list">
            <dt>Unit</dt>
            <dd>{a.testingStrategy.unitTesting.approach}</dd>
            <dt>Integration</dt>
            <dd>{a.testingStrategy.integrationTesting.approach}</dd>
            {a.testingStrategy.apiTesting && (
              <>
                <dt>API</dt>
                <dd>{a.testingStrategy.apiTesting.approach}</dd>
              </>
            )}
            {a.testingStrategy.frontendTesting && (
              <>
                <dt>Frontend</dt>
                <dd>{a.testingStrategy.frontendTesting.approach}</dd>
              </>
            )}
            <dt>End-to-end</dt>
            <dd>{a.testingStrategy.e2eTesting.approach}</dd>
          </dl>
          {a.testingStrategy.validationCommands.length > 0 && (
            <p className="analysis-card-meta">
              Validation commands: {a.testingStrategy.validationCommands.join(', ')}
            </p>
          )}
        </div>
      </section>

      <section className="analysis-section">
        <h3>Non-Functional Decisions</h3>
        {a.nonFunctionalDecisions.length === 0 ? (
          <Empty>No non-functional decisions recorded.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.nonFunctionalDecisions.map((d, i) => (
              <li key={i} className="analysis-card">
                <strong>{d.requirement}</strong>
                <p>{d.decision}</p>
                <p className="analysis-card-meta">{d.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Architecture Decisions</h3>
        {a.architectureDecisions.length === 0 ? (
          <Empty>No architecture decision records.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.architectureDecisions.map((adr) => (
              <li key={adr.id} className="adr-card">
                <div className="analysis-card-header">
                  <strong>
                    {adr.id} — {adr.title}
                  </strong>
                </div>
                <p>{adr.decision}</p>
                <p className="analysis-card-meta">{adr.rationale}</p>
                <details>
                  <summary>Context &amp; alternatives</summary>
                  <p>{adr.context}</p>
                  {adr.alternativesConsidered.length > 0 && (
                    <>
                      <p className="analysis-card-meta">Alternatives considered:</p>
                      <Chips items={adr.alternativesConsidered} />
                    </>
                  )}
                  {adr.consequences.length > 0 && (
                    <>
                      <p className="analysis-card-meta">Consequences:</p>
                      <Chips items={adr.consequences} />
                    </>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-section">
        <h3>Requirement Traceability</h3>
        {a.requirementTraceability.length === 0 ? (
          <Empty>No requirement traceability recorded.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.requirementTraceability.map((t, i) => (
              <li key={i} className="analysis-card traceability-row">
                <strong>{t.requirementId}</strong>
                <span className="traceability-arrow">→</span>
                <span>{t.architectureAreas.join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {a.constraints.length > 0 && (
        <section className="analysis-section">
          <h3>Constraints</h3>
          <Chips items={a.constraints} />
        </section>
      )}

      <section className="analysis-section analysis-section--highlight">
        <h3>Unresolved Questions</h3>
        {a.unresolvedQuestions.length === 0 ? (
          <Empty>No unresolved questions — the architecture is fully specified.</Empty>
        ) : (
          <ul className="analysis-card-list">
            {a.unresolvedQuestions.map((q, i) => (
              <li key={i} className="analysis-card">
                <strong>{q.question}</strong>
                <p>{q.impact}</p>
                {q.recommendation && <p className="analysis-card-meta">Suggestion: {q.recommendation}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
