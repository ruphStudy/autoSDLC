export interface PromptOutput {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * A source-controlled, versioned prompt. `version` matters later: a stored
 * result should be traceable to exactly which template produced it.
 */
export interface PromptTemplate<TContext> {
  name: string;
  version: string;
  build(context: TContext): PromptOutput;
}

export function definePromptTemplate<TContext>(
  template: PromptTemplate<TContext>,
): PromptTemplate<TContext> {
  return template;
}

/** e.g. "project-analysis:v1" — a compact id for logs/metadata. */
export function promptTemplateId(
  template: Pick<PromptTemplate<unknown>, 'name' | 'version'>,
): string {
  return `${template.name}:v${template.version}`;
}
