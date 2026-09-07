import { ArchitectureContentSchema } from './architecture.schema';

function validArchitecture() {
  return {
    summary:
      'A modular NestJS monolith with a React SPA frontend, backed by PostgreSQL.',
    frontendArchitecture: {
      framework: 'React',
      language: 'TypeScript',
      componentStrategy: 'Feature-organized function components with hooks.',
      keyLibraries: ['react-router-dom', 'axios'],
    },
    backendArchitecture: {
      framework: 'NestJS',
      language: 'TypeScript',
      architecturalStyle: 'Modular monolith',
      modules: [
        {
          name: 'interviews',
          responsibility: 'Manages mock interview sessions.',
        },
      ],
    },
    apiArchitecture: {
      style: 'REST',
      conventions: ['Resource-oriented URLs', 'JSON request/response bodies'],
      majorResourceGroups: [
        { name: 'interviews', purpose: 'CRUD for interview sessions.' },
      ],
    },
    databaseArchitecture: {
      databaseType: 'Relational',
      technology: 'PostgreSQL',
      rationale: 'Strong consistency and mature tooling for a CRUD-heavy MVP.',
      majorEntities: [
        {
          name: 'InterviewSession',
          purpose: 'One practice interview attempt.',
        },
      ],
    },
    authenticationArchitecture: {
      authenticationMethod: 'JWT',
      tokenOrSessionStrategy:
        'Short-lived access token + rotating refresh token.',
      authorizationModel: 'Owner-only resource access.',
    },
    integrationArchitecture: [
      {
        name: 'Speech-to-text API',
        purpose: 'Transcribe answers',
        direction: 'outbound',
      },
    ],
    infrastructureArchitecture: {
      runtimeComponents: ['API server', 'PostgreSQL database'],
    },
    deploymentArchitecture: {
      environments: ['development', 'production'],
      deploymentStrategy: 'Single-region container deployment.',
      ciCdApproach: 'Run lint/test/build on every push; deploy main on green.',
      configurationStrategy: 'Environment variables per environment.',
      secretsStrategy: 'Managed secret store, never committed.',
    },
    securityArchitecture: {
      controls: [
        { area: 'Authentication', recommendation: 'bcrypt password hashing.' },
      ],
    },
    testingStrategy: {
      unitTesting: { approach: 'Jest for services and utilities.' },
      integrationTesting: {
        approach: 'Supertest against a real test database.',
      },
      e2eTesting: { approach: 'Supertest-driven API flows for now.' },
      validationCommands: ['lint', 'test', 'build'],
    },
    nonFunctionalDecisions: [
      {
        requirement: 'performance',
        decision: 'Paginate list endpoints.',
        rationale: 'Keeps response times bounded.',
      },
    ],
    architectureDecisions: [
      {
        id: 'ADR-001',
        title: 'Use a modular monolith',
        context: 'MVP with a small team and uncertain scaling needs.',
        decision:
          'Single deployable NestJS app organized into feature modules.',
        rationale: 'Simpler operations; can extract services later if needed.',
      },
    ],
    requirementTraceability: [
      {
        requirementId: 'FR-001',
        architectureAreas: ['backendArchitecture', 'databaseArchitecture'],
      },
    ],
    unresolvedQuestions: [
      {
        question: 'Should sessions be recorded?',
        impact: 'Affects storage architecture.',
      },
    ],
    constraints: ['Must use the requested React + NestJS + PostgreSQL stack.'],
  };
}

describe('ArchitectureContentSchema', () => {
  it('accepts a fully valid architecture', () => {
    expect(
      ArchitectureContentSchema.safeParse(validArchitecture()).success,
    ).toBe(true);
  });

  it('fills in missing optional arrays with []', () => {
    const arch = validArchitecture();
    const frontendRest: Record<string, unknown> = {
      ...arch.frontendArchitecture,
    };
    delete frontendRest.keyLibraries;
    arch.frontendArchitecture =
      frontendRest as typeof arch.frontendArchitecture;
    const result = ArchitectureContentSchema.safeParse(arch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frontendArchitecture.keyLibraries).toEqual([]);
    }
  });

  it('rejects a missing summary', () => {
    const arch: Record<string, unknown> = validArchitecture();
    delete arch.summary;
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects a malformed frontendArchitecture (missing required framework)', () => {
    const arch = validArchitecture();
    const frontend = arch.frontendArchitecture as Record<string, unknown>;
    delete frontend.framework;
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects a malformed backendArchitecture (empty modules array)', () => {
    const arch = validArchitecture();
    arch.backendArchitecture.modules = [];
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects an invalid API style', () => {
    const arch = validArchitecture();
    arch.apiArchitecture.style = 'SOAP';
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects an invalid integration direction', () => {
    const arch = validArchitecture();
    arch.integrationArchitecture[0].direction = 'sideways';
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects a malformed security section (missing recommendation)', () => {
    const arch = validArchitecture();
    delete (arch.securityArchitecture.controls[0] as Record<string, unknown>)
      .recommendation;
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects an invalid ADR id format', () => {
    const arch = validArchitecture();
    arch.architectureDecisions[0].id = 'ADR-x';
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects duplicate ADR ids', () => {
    const arch = validArchitecture();
    arch.architectureDecisions.push({ ...arch.architectureDecisions[0] });
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects a malformed traceability entry (invalid requirement id format)', () => {
    const arch = validArchitecture();
    arch.requirementTraceability[0].requirementId = 'requirement-one';
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects a traceability entry with no architecture areas', () => {
    const arch = validArchitecture();
    arch.requirementTraceability[0].architectureAreas = [];
    expect(ArchitectureContentSchema.safeParse(arch).success).toBe(false);
  });

  it('allows empty optional sections (integrations, unresolved questions, constraints)', () => {
    const arch = validArchitecture();
    const result = ArchitectureContentSchema.safeParse({
      ...arch,
      integrationArchitecture: [],
      unresolvedQuestions: [],
      constraints: [],
    });
    expect(result.success).toBe(true);
  });
});
