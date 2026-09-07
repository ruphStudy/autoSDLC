import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { architectureApi } from '../api/architecture.api';
import { ListEditor } from '../project-analysis/ListEditor';
import type {
  ApiStyle,
  Architecture,
  ArchitectureDecision,
  ArchitectureEditPayload,
  BackendModule,
  DatabaseEntity,
  IntegrationArchitectureItem,
  IntegrationDirection,
  NonFunctionalDecision,
  RequirementTraceability,
  SecurityControl,
  UnresolvedArchitectureQuestion,
} from '../architecture/types';

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

type EditableContent = Omit<
  ArchitectureEditPayload,
  | 'frontendArchitecture'
  | 'backendArchitecture'
  | 'apiArchitecture'
  | 'databaseArchitecture'
  | 'authenticationArchitecture'
  | 'infrastructureArchitecture'
  | 'deploymentArchitecture'
  | 'securityArchitecture'
  | 'testingStrategy'
> &
  Required<
    Pick<
      ArchitectureEditPayload,
      | 'frontendArchitecture'
      | 'backendArchitecture'
      | 'apiArchitecture'
      | 'databaseArchitecture'
      | 'authenticationArchitecture'
      | 'infrastructureArchitecture'
      | 'deploymentArchitecture'
      | 'securityArchitecture'
      | 'testingStrategy'
    >
  >;

function fromArchitecture(a: Architecture): EditableContent {
  return {
    summary: a.summary,
    frontendArchitecture: a.frontendArchitecture,
    backendArchitecture: a.backendArchitecture,
    apiArchitecture: a.apiArchitecture,
    databaseArchitecture: a.databaseArchitecture,
    authenticationArchitecture: a.authenticationArchitecture,
    integrationArchitecture: a.integrationArchitecture,
    infrastructureArchitecture: a.infrastructureArchitecture,
    deploymentArchitecture: a.deploymentArchitecture,
    securityArchitecture: a.securityArchitecture,
    testingStrategy: a.testingStrategy,
    nonFunctionalDecisions: a.nonFunctionalDecisions,
    architectureDecisions: a.architectureDecisions,
    requirementTraceability: a.requirementTraceability,
    unresolvedQuestions: a.unresolvedQuestions,
    constraints: a.constraints,
  };
}

export function EditArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState<EditableContent | null>(null);

  useEffect(() => {
    if (!id) return;
    architectureApi
      .getArchitecture(id)
      .then((architecture) => {
        setContent(fromArchitecture(architecture));
        setLoaded(true);
      })
      .catch(() => setError('This architecture could not be loaded.'));
  }, [id]);

  const update = <K extends keyof EditableContent>(key: K, value: EditableContent[K]) =>
    setContent((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || submitting || !content) return;
    setSubmitting(true);
    setError(null);
    try {
      // Optional testing-strategy sub-sections: omit rather than send a
      // blank approach.
      const testingStrategy = { ...content.testingStrategy };
      if (!testingStrategy.apiTesting?.approach) delete testingStrategy.apiTesting;
      if (!testingStrategy.frontendTesting?.approach) delete testingStrategy.frontendTesting;

      await architectureApi.updateArchitecture(id, { ...content, testingStrategy });
      navigate(`/projects/${id}/architecture`, { replace: true });
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
        <Link to={`/projects/${id}/architecture`}>Back to architecture</Link>
      </div>
    );
  }

  if (!content) {
    return <p>Loading…</p>;
  }

  const fe = content.frontendArchitecture;
  const be = content.backendArchitecture;
  const api = content.apiArchitecture;
  const db = content.databaseArchitecture;
  const auth = content.authenticationArchitecture;
  const infra = content.infrastructureArchitecture;
  const deploy = content.deploymentArchitecture;
  const sec = content.securityArchitecture;
  const testing = content.testingStrategy;

  return (
    <div className="form-page form-page--wide">
      <h1>Edit Architecture</h1>

      <form className="project-form" onSubmit={handleSubmit}>
        <label htmlFor="summary">Architecture Summary</label>
        <textarea
          id="summary"
          rows={4}
          value={content.summary}
          onChange={(e) => update('summary', e.target.value)}
        />

        <fieldset className="analysis-edit-section">
          <legend>Frontend</legend>
          <label>Framework</label>
          <input
            type="text"
            value={fe.framework}
            onChange={(e) => update('frontendArchitecture', { ...fe, framework: e.target.value })}
          />
          <label>Language</label>
          <input
            type="text"
            value={fe.language}
            onChange={(e) => update('frontendArchitecture', { ...fe, language: e.target.value })}
          />
          <label>Component strategy</label>
          <input
            type="text"
            value={fe.componentStrategy}
            onChange={(e) =>
              update('frontendArchitecture', { ...fe, componentStrategy: e.target.value })
            }
          />
          <label>Rendering strategy</label>
          <input
            type="text"
            value={fe.renderingStrategy ?? ''}
            onChange={(e) =>
              update('frontendArchitecture', {
                ...fe,
                renderingStrategy: e.target.value || undefined,
              })
            }
          />
          <label>State management</label>
          <input
            type="text"
            value={fe.stateManagement ?? ''}
            onChange={(e) =>
              update('frontendArchitecture', {
                ...fe,
                stateManagement: e.target.value || undefined,
              })
            }
          />
          <label>Routing</label>
          <input
            type="text"
            value={fe.routing ?? ''}
            onChange={(e) =>
              update('frontendArchitecture', { ...fe, routing: e.target.value || undefined })
            }
          />
          <label>Styling</label>
          <input
            type="text"
            value={fe.styling ?? ''}
            onChange={(e) =>
              update('frontendArchitecture', { ...fe, styling: e.target.value || undefined })
            }
          />
          <CommaListField
            label="Key libraries"
            value={fe.keyLibraries}
            onChange={(v) => update('frontendArchitecture', { ...fe, keyLibraries: v })}
          />
          <CommaListField
            label="Folder structure"
            value={fe.folderStructure}
            onChange={(v) => update('frontendArchitecture', { ...fe, folderStructure: v })}
          />
          <CommaListField
            label="Notes"
            value={fe.notes}
            onChange={(v) => update('frontendArchitecture', { ...fe, notes: v })}
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Backend</legend>
          <label>Framework</label>
          <input
            type="text"
            value={be.framework}
            onChange={(e) => update('backendArchitecture', { ...be, framework: e.target.value })}
          />
          <label>Language</label>
          <input
            type="text"
            value={be.language}
            onChange={(e) => update('backendArchitecture', { ...be, language: e.target.value })}
          />
          <label>Architectural style</label>
          <input
            type="text"
            value={be.architecturalStyle}
            onChange={(e) =>
              update('backendArchitecture', { ...be, architecturalStyle: e.target.value })
            }
          />
          <ListEditor<BackendModule>
            title="Modules"
            items={be.modules}
            onChange={(modules) => update('backendArchitecture', { ...be, modules })}
            createItem={() => ({ name: '', responsibility: '' })}
            renderItem={(item, updateItem) => (
              <>
                <input
                  type="text"
                  placeholder="Name"
                  value={item.name}
                  onChange={(e) => updateItem({ name: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Responsibility"
                  value={item.responsibility}
                  onChange={(e) => updateItem({ responsibility: e.target.value })}
                />
              </>
            )}
          />
          <CommaListField
            label="Service boundaries"
            value={be.serviceBoundaries}
            onChange={(v) => update('backendArchitecture', { ...be, serviceBoundaries: v })}
          />
          <CommaListField
            label="Key libraries"
            value={be.keyLibraries}
            onChange={(v) => update('backendArchitecture', { ...be, keyLibraries: v })}
          />
          <CommaListField
            label="Notes"
            value={be.notes}
            onChange={(v) => update('backendArchitecture', { ...be, notes: v })}
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>API</legend>
          <label>Style</label>
          <select
            value={api.style}
            onChange={(e) => update('apiArchitecture', { ...api, style: e.target.value as ApiStyle })}
          >
            <option value="REST">REST</option>
            <option value="GraphQL">GraphQL</option>
            <option value="RPC">RPC</option>
            <option value="Mixed">Mixed</option>
          </select>
          <label>Versioning strategy</label>
          <input
            type="text"
            value={api.versioningStrategy ?? ''}
            onChange={(e) =>
              update('apiArchitecture', {
                ...api,
                versioningStrategy: e.target.value || undefined,
              })
            }
          />
          <CommaListField
            label="Conventions"
            value={api.conventions}
            onChange={(v) => update('apiArchitecture', { ...api, conventions: v })}
          />
          <ListEditor
            title="Major resource groups"
            items={api.majorResourceGroups}
            onChange={(majorResourceGroups) =>
              update('apiArchitecture', { ...api, majorResourceGroups })
            }
            createItem={() => ({ name: '', purpose: '' })}
            renderItem={(item, updateItem) => (
              <>
                <input
                  type="text"
                  placeholder="Name"
                  value={item.name}
                  onChange={(e) => updateItem({ name: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Purpose"
                  value={item.purpose}
                  onChange={(e) => updateItem({ purpose: e.target.value })}
                />
              </>
            )}
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Database</legend>
          <label>Database type</label>
          <input
            type="text"
            value={db.databaseType}
            onChange={(e) => update('databaseArchitecture', { ...db, databaseType: e.target.value })}
          />
          <label>Technology</label>
          <input
            type="text"
            value={db.technology}
            onChange={(e) => update('databaseArchitecture', { ...db, technology: e.target.value })}
          />
          <label>Rationale</label>
          <input
            type="text"
            value={db.rationale}
            onChange={(e) => update('databaseArchitecture', { ...db, rationale: e.target.value })}
          />
          <ListEditor<DatabaseEntity>
            title="Major entities"
            items={db.majorEntities}
            onChange={(majorEntities) => update('databaseArchitecture', { ...db, majorEntities })}
            createItem={() => ({ name: '', purpose: '', relationships: [] })}
            renderItem={(item, updateItem) => (
              <>
                <input
                  type="text"
                  placeholder="Name"
                  value={item.name}
                  onChange={(e) => updateItem({ name: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Purpose"
                  value={item.purpose}
                  onChange={(e) => updateItem({ purpose: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Relationships (comma-separated)"
                  value={item.relationships.join(', ')}
                  onChange={(e) => updateItem({ relationships: toList(e.target.value) })}
                />
              </>
            )}
          />
          <CommaListField
            label="Indexing strategy"
            value={db.indexingStrategy}
            onChange={(v) => update('databaseArchitecture', { ...db, indexingStrategy: v })}
          />
          <label>Migration strategy</label>
          <input
            type="text"
            value={db.migrationStrategy ?? ''}
            onChange={(e) =>
              update('databaseArchitecture', {
                ...db,
                migrationStrategy: e.target.value || undefined,
              })
            }
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Authentication &amp; Authorization</legend>
          <label>Authentication method</label>
          <input
            type="text"
            value={auth.authenticationMethod}
            onChange={(e) =>
              update('authenticationArchitecture', { ...auth, authenticationMethod: e.target.value })
            }
          />
          <label>Token / session strategy</label>
          <input
            type="text"
            value={auth.tokenOrSessionStrategy}
            onChange={(e) =>
              update('authenticationArchitecture', {
                ...auth,
                tokenOrSessionStrategy: e.target.value,
              })
            }
          />
          <label>Authorization model</label>
          <input
            type="text"
            value={auth.authorizationModel}
            onChange={(e) =>
              update('authenticationArchitecture', { ...auth, authorizationModel: e.target.value })
            }
          />
          <CommaListField
            label="Roles"
            value={auth.roles}
            onChange={(v) => update('authenticationArchitecture', { ...auth, roles: v })}
          />
          <CommaListField
            label="Security notes"
            value={auth.securityNotes}
            onChange={(v) => update('authenticationArchitecture', { ...auth, securityNotes: v })}
          />
        </fieldset>

        <ListEditor<IntegrationArchitectureItem>
          title="Integrations"
          items={content.integrationArchitecture ?? []}
          onChange={(integrationArchitecture) => update('integrationArchitecture', integrationArchitecture)}
          createItem={() => ({ name: '', purpose: '', direction: 'outbound' })}
          renderItem={(item, updateItem) => (
            <>
              <input
                type="text"
                placeholder="Name"
                value={item.name}
                onChange={(e) => updateItem({ name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Purpose"
                value={item.purpose}
                onChange={(e) => updateItem({ purpose: e.target.value })}
              />
              <select
                value={item.direction}
                onChange={(e) => updateItem({ direction: e.target.value as IntegrationDirection })}
              >
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
                <option value="bidirectional">Bidirectional</option>
              </select>
            </>
          )}
        />

        <fieldset className="analysis-edit-section">
          <legend>Infrastructure</legend>
          <CommaListField
            label="Runtime components"
            value={infra.runtimeComponents}
            onChange={(v) => update('infrastructureArchitecture', { ...infra, runtimeComponents: v })}
          />
          <label>Compute</label>
          <input
            type="text"
            value={infra.compute ?? ''}
            onChange={(e) =>
              update('infrastructureArchitecture', { ...infra, compute: e.target.value || undefined })
            }
          />
          <label>Cache</label>
          <input
            type="text"
            value={infra.cache ?? ''}
            onChange={(e) =>
              update('infrastructureArchitecture', { ...infra, cache: e.target.value || undefined })
            }
          />
          <label>Queue</label>
          <input
            type="text"
            value={infra.queue ?? ''}
            onChange={(e) =>
              update('infrastructureArchitecture', { ...infra, queue: e.target.value || undefined })
            }
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Deployment</legend>
          <CommaListField
            label="Environments"
            value={deploy.environments}
            onChange={(v) => update('deploymentArchitecture', { ...deploy, environments: v })}
          />
          <label>Deployment strategy</label>
          <input
            type="text"
            value={deploy.deploymentStrategy}
            onChange={(e) =>
              update('deploymentArchitecture', { ...deploy, deploymentStrategy: e.target.value })
            }
          />
          <label>CI/CD approach</label>
          <input
            type="text"
            value={deploy.ciCdApproach}
            onChange={(e) => update('deploymentArchitecture', { ...deploy, ciCdApproach: e.target.value })}
          />
          <label>Configuration strategy</label>
          <input
            type="text"
            value={deploy.configurationStrategy}
            onChange={(e) =>
              update('deploymentArchitecture', { ...deploy, configurationStrategy: e.target.value })
            }
          />
          <label>Secrets strategy</label>
          <input
            type="text"
            value={deploy.secretsStrategy}
            onChange={(e) =>
              update('deploymentArchitecture', { ...deploy, secretsStrategy: e.target.value })
            }
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Security</legend>
          <ListEditor<SecurityControl>
            title="Controls"
            items={sec.controls}
            onChange={(controls) => update('securityArchitecture', { ...sec, controls })}
            createItem={() => ({ area: '', recommendation: '' })}
            renderItem={(item, updateItem) => (
              <>
                <input
                  type="text"
                  placeholder="Area"
                  value={item.area}
                  onChange={(e) => updateItem({ area: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Recommendation"
                  value={item.recommendation}
                  onChange={(e) => updateItem({ recommendation: e.target.value })}
                />
              </>
            )}
          />
          <CommaListField
            label="Data protection"
            value={sec.dataProtection}
            onChange={(v) => update('securityArchitecture', { ...sec, dataProtection: v })}
          />
          <CommaListField
            label="Secrets management"
            value={sec.secretsManagement}
            onChange={(v) => update('securityArchitecture', { ...sec, secretsManagement: v })}
          />
        </fieldset>

        <fieldset className="analysis-edit-section">
          <legend>Testing Strategy</legend>
          <label>Unit testing approach</label>
          <input
            type="text"
            value={testing.unitTesting.approach}
            onChange={(e) =>
              update('testingStrategy', {
                ...testing,
                unitTesting: { ...testing.unitTesting, approach: e.target.value },
              })
            }
          />
          <label>Integration testing approach</label>
          <input
            type="text"
            value={testing.integrationTesting.approach}
            onChange={(e) =>
              update('testingStrategy', {
                ...testing,
                integrationTesting: { ...testing.integrationTesting, approach: e.target.value },
              })
            }
          />
          <label>End-to-end testing approach</label>
          <input
            type="text"
            value={testing.e2eTesting.approach}
            onChange={(e) =>
              update('testingStrategy', {
                ...testing,
                e2eTesting: { ...testing.e2eTesting, approach: e.target.value },
              })
            }
          />
          <CommaListField
            label="Validation commands"
            value={testing.validationCommands}
            onChange={(v) => update('testingStrategy', { ...testing, validationCommands: v })}
          />
        </fieldset>

        <ListEditor<NonFunctionalDecision>
          title="Non-Functional Decisions"
          items={content.nonFunctionalDecisions ?? []}
          onChange={(nonFunctionalDecisions) => update('nonFunctionalDecisions', nonFunctionalDecisions)}
          createItem={() => ({ requirement: '', decision: '', rationale: '' })}
          renderItem={(item, updateItem) => (
            <>
              <input
                type="text"
                placeholder="Requirement"
                value={item.requirement}
                onChange={(e) => updateItem({ requirement: e.target.value })}
              />
              <input
                type="text"
                placeholder="Decision"
                value={item.decision}
                onChange={(e) => updateItem({ decision: e.target.value })}
              />
              <input
                type="text"
                placeholder="Rationale"
                value={item.rationale}
                onChange={(e) => updateItem({ rationale: e.target.value })}
              />
            </>
          )}
        />

        <ListEditor<ArchitectureDecision>
          title="Architecture Decisions (ADRs)"
          items={content.architectureDecisions ?? []}
          onChange={(architectureDecisions) => update('architectureDecisions', architectureDecisions)}
          createItem={() => ({
            id: `ADR-${String((content.architectureDecisions?.length ?? 0) + 1).padStart(3, '0')}`,
            title: '',
            context: '',
            decision: '',
            rationale: '',
            alternativesConsidered: [],
            consequences: [],
          })}
          renderItem={(item, updateItem) => (
            <>
              <input
                type="text"
                placeholder="ID (e.g. ADR-001)"
                value={item.id}
                onChange={(e) => updateItem({ id: e.target.value })}
              />
              <input
                type="text"
                placeholder="Title"
                value={item.title}
                onChange={(e) => updateItem({ title: e.target.value })}
              />
              <input
                type="text"
                placeholder="Context"
                value={item.context}
                onChange={(e) => updateItem({ context: e.target.value })}
              />
              <input
                type="text"
                placeholder="Decision"
                value={item.decision}
                onChange={(e) => updateItem({ decision: e.target.value })}
              />
              <input
                type="text"
                placeholder="Rationale"
                value={item.rationale}
                onChange={(e) => updateItem({ rationale: e.target.value })}
              />
            </>
          )}
        />

        <ListEditor<RequirementTraceability>
          title="Requirement Traceability"
          items={content.requirementTraceability ?? []}
          onChange={(requirementTraceability) => update('requirementTraceability', requirementTraceability)}
          createItem={() => ({ requirementId: 'FR-001', architectureAreas: [] })}
          renderItem={(item, updateItem) => (
            <>
              <input
                type="text"
                placeholder="Requirement ID (e.g. FR-001)"
                value={item.requirementId}
                onChange={(e) => updateItem({ requirementId: e.target.value })}
              />
              <input
                type="text"
                placeholder="Architecture areas (comma-separated)"
                value={item.architectureAreas.join(', ')}
                onChange={(e) => updateItem({ architectureAreas: toList(e.target.value) })}
              />
            </>
          )}
        />

        <ListEditor<UnresolvedArchitectureQuestion>
          title="Unresolved Questions"
          items={content.unresolvedQuestions ?? []}
          onChange={(unresolvedQuestions) => update('unresolvedQuestions', unresolvedQuestions)}
          createItem={() => ({ question: '', impact: '' })}
          renderItem={(item, updateItem) => (
            <>
              <input
                type="text"
                placeholder="Question"
                value={item.question}
                onChange={(e) => updateItem({ question: e.target.value })}
              />
              <input
                type="text"
                placeholder="Impact"
                value={item.impact}
                onChange={(e) => updateItem({ impact: e.target.value })}
              />
            </>
          )}
        />

        <fieldset className="analysis-edit-section">
          <legend>Constraints</legend>
          <CommaListField
            label="Constraints"
            value={content.constraints ?? []}
            onChange={(v) => update('constraints', v)}
          />
        </fieldset>

        {error && <p className="form-error">{error}</p>}

        <div className="project-form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/projects/${id}/architecture`)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
