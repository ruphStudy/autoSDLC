import { TaskInstructionContent } from '../schemas/task-instruction-content.schema';
import { TaskContext } from '../contracts/task-context.types';
import { isPathWithinWorkspace } from '../repository/file-safety.util';

export interface ValidationFailure {
  reason: string;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Application-level preservation checks (items 78-83) — the AI's own
// adherence to the prompt's rules is never trusted on its own; every one of
// these is re-verified in code before an instruction is ever persisted.
export function validateInstructionContent(
  content: TaskInstructionContent,
  task: {
    acceptanceCriteria: string[];
    validationExpectations: Array<{
      type: string;
      description: string;
      required: boolean;
    }>;
    requirementIds: string[];
  },
  context: TaskContext,
  workspacePath: string,
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  // Acceptance criteria must survive verbatim (item 79) — normalized
  // equality, not fuzzy matching, per the prompt's own explicit instruction
  // to copy them exactly.
  const resultCriteria = new Set(content.acceptanceCriteria.map(normalize));
  for (const criterion of task.acceptanceCriteria) {
    if (!resultCriteria.has(normalize(criterion))) {
      failures.push({ reason: `Missing acceptance criterion: "${criterion}"` });
    }
  }

  // Every REQUIRED validation expectation must survive with the same
  // type+description (item 81).
  const requiredExpectations = task.validationExpectations.filter(
    (v) => v.required,
  );
  for (const expectation of requiredExpectations) {
    const found = content.validationPlan.some(
      (v) =>
        v.required &&
        v.type === expectation.type &&
        normalize(v.description) === normalize(expectation.description),
    );
    if (!found) {
      failures.push({
        reason: `Missing required validation expectation: [${expectation.type}] "${expectation.description}"`,
      });
    }
  }

  // requirementIds must be a subset of the Task's own — never invented
  // (item 80).
  const validRequirementIds = new Set(task.requirementIds);
  for (const id of content.requirementIds) {
    if (!validRequirementIds.has(id)) {
      failures.push({
        reason: `Invented requirement id not on this Task: "${id}"`,
      });
    }
  }

  // dependencyContext task keys must be a subset of the Task's actual
  // dependencies — never invented (item 82).
  const validDependencyKeys = new Set(
    context.dependencies.map((d) => d.taskKey),
  );
  for (const dep of content.dependencyContext) {
    if (!validDependencyKeys.has(dep.taskKey)) {
      failures.push({
        reason: `Invented dependency Task key: "${dep.taskKey}"`,
      });
    }
  }

  // likelyFiles must stay workspace-relative and contained — never an
  // absolute system path or a traversal outside the workspace (item 83).
  for (const step of content.implementationPlan) {
    for (const file of step.likelyFiles ?? []) {
      if (!isPathWithinWorkspace(file, workspacePath)) {
        failures.push({
          reason: `Unsafe likelyFiles path outside the workspace: "${file}"`,
        });
      }
    }
  }

  return failures;
}
