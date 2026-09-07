import { ProjectAnalysisContentSchema } from './project-analysis.schema';

function validAnalysis() {
  return {
    summary:
      'A mock interview platform that helps candidates practice technical interviews.',
    targetUsers: [
      {
        name: 'Job seekers',
        description: 'Engineers preparing for interviews',
        needs: ['practice'],
      },
    ],
    goals: [
      {
        title: 'Increase interview confidence',
        description: 'Help users feel prepared',
        priority: 'high',
      },
    ],
    features: [
      {
        name: 'Mock interview sessions',
        description: 'AI-led mock interviews',
        priority: 'must_have',
      },
    ],
    functionalRequirements: [
      {
        id: 'FR-001',
        title: 'Start a mock interview',
        description: 'Authenticated users can start a mock interview session.',
        priority: 'must_have',
      },
    ],
    nonFunctionalRequirements: [
      {
        category: 'performance',
        requirement: 'Responses render within 2 seconds.',
        priority: 'high',
      },
    ],
    assumptions: [{ assumption: 'Users have a working microphone.' }],
    risks: [
      { risk: 'Low-quality audio may reduce accuracy.', severity: 'medium' },
    ],
    unresolvedQuestions: [
      { question: 'Should sessions be recorded?', importance: 'medium' },
    ],
    integrations: [
      {
        name: 'Speech-to-text API',
        purpose: 'Transcribe responses',
        required: true,
      },
    ],
  };
}

describe('ProjectAnalysisContentSchema', () => {
  it('accepts a fully valid analysis', () => {
    const result = ProjectAnalysisContentSchema.safeParse(validAnalysis());
    expect(result.success).toBe(true);
  });

  it('accepts empty arrays for sections with nothing to report', () => {
    const result = ProjectAnalysisContentSchema.safeParse({
      ...validAnalysis(),
      risks: [],
      integrations: [],
    });
    expect(result.success).toBe(true);
  });

  it('fills in missing optional arrays with []', () => {
    const { summary, ...rest } = validAnalysis();
    void rest;
    const result = ProjectAnalysisContentSchema.safeParse({ summary });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.features).toEqual([]);
      expect(result.data.risks).toEqual([]);
    }
  });

  it('rejects a missing summary', () => {
    const rest: Record<string, unknown> = validAnalysis();
    delete rest.summary;
    const result = ProjectAnalysisContentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid feature priority', () => {
    const analysis = validAnalysis();
    analysis.features[0].priority = 'urgent';
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid risk severity', () => {
    const analysis = validAnalysis();
    analysis.risks[0].severity = 'catastrophic';
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('rejects non-array feature data', () => {
    const analysis = { ...validAnalysis(), features: 'lots of features' };
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed functional requirement (missing description)', () => {
    const analysis = validAnalysis();
    delete (analysis.functionalRequirements[0] as Record<string, unknown>)
      .description;
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('rejects a functional requirement id that does not look like FR-001', () => {
    const analysis = validAnalysis();
    analysis.functionalRequirements[0].id = 'requirement-one';
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate functional requirement ids', () => {
    const analysis = validAnalysis();
    analysis.functionalRequirements.push({
      ...analysis.functionalRequirements[0],
    });
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });

  it('enforces the required core fields on nested items (e.g. risk text)', () => {
    const analysis = validAnalysis();
    analysis.risks[0].risk = '';
    const result = ProjectAnalysisContentSchema.safeParse(analysis);
    expect(result.success).toBe(false);
  });
});
