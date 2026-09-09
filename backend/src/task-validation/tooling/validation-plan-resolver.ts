import { Injectable } from '@nestjs/common';
import { ValidationCheckType } from '@prisma/client';
import { RepositoryToolingDetector } from './repository-tooling-detector';
import { DetectedPackage, PackageManager } from './tooling.types';
import {
  TaskValidationExpectation,
  ValidationCheck,
} from '../types/validation-plan.types';

// Task.validationExpectations uses the Sprint 6 ValidationExpectationType
// vocabulary (lint/typecheck/unit_test/integration_test/e2e_test/build/
// manual/other) — mapped here to the Validation Engine's own
// ValidationCheckType. 'manual' and 'other' never resolve to a real
// command: a manual check is inherently a human action, and 'other' has no
// fixed meaning to safely infer a command from.
const EXPECTATION_TO_CHECK_TYPE: Record<string, ValidationCheckType | null> = {
  lint: ValidationCheckType.LINT,
  typecheck: ValidationCheckType.TYPECHECK,
  unit_test: ValidationCheckType.UNIT_TEST,
  integration_test: ValidationCheckType.INTEGRATION_TEST,
  e2e_test: ValidationCheckType.E2E_TEST,
  build: ValidationCheckType.BUILD,
  manual: null,
  other: null,
};

// A bounded, well-known set of script-name spellings per check type — not
// "dozens of specialized types" (item 5), just the handful of real-world
// conventions worth recognizing (item 19). The first matching alias found
// on a package wins.
const SCRIPT_ALIASES: Partial<Record<ValidationCheckType, string[]>> = {
  [ValidationCheckType.LINT]: ['lint'],
  [ValidationCheckType.TYPECHECK]: ['typecheck', 'type-check'],
  [ValidationCheckType.UNIT_TEST]: ['test:unit', 'test'],
  [ValidationCheckType.INTEGRATION_TEST]: ['test:integration', 'test:int'],
  [ValidationCheckType.E2E_TEST]: ['test:e2e', 'e2e'],
  [ValidationCheckType.BUILD]: ['build'],
};

const CHECK_TYPE_LABEL: Record<ValidationCheckType, string> = {
  [ValidationCheckType.LINT]: 'Lint',
  [ValidationCheckType.TYPECHECK]: 'Typecheck',
  [ValidationCheckType.UNIT_TEST]: 'Unit tests',
  [ValidationCheckType.INTEGRATION_TEST]: 'Integration tests',
  [ValidationCheckType.E2E_TEST]: 'E2E tests',
  [ValidationCheckType.BUILD]: 'Build',
  [ValidationCheckType.CUSTOM]: 'Custom check',
};

function commandForScript(
  manager: PackageManager,
  script: string,
): { command: string; args: string[] } {
  switch (manager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['run', script] };
    case 'yarn':
      return { command: 'yarn', args: ['run', script] };
    case 'bun':
      return { command: 'bun', args: ['run', script] };
    case 'npm':
    default:
      return { command: 'npm', args: ['run', script] };
  }
}

// `tsc --noEmit` is the one narrow, deliberate exception to "never invent a
// command" (item 20): it is inherently read-only (no output written, no
// dependency installed), and is only ever used when a tsconfig.json AND a
// real `typescript` dependency are both already present — i.e. the tooling
// is "clearly present and safe", exactly the bar item 20 sets.
// `--no-install`/pnpm's default `exec` behavior/yarn/bunx's `--no-install`
// all ensure this never silently installs typescript (item 21).
function commandForTscFallback(manager: PackageManager): {
  command: string;
  args: string[];
} {
  switch (manager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'tsc', '--noEmit'] };
    case 'yarn':
      return { command: 'yarn', args: ['tsc', '--noEmit'] };
    case 'bun':
      return { command: 'bunx', args: ['--no-install', 'tsc', '--noEmit'] };
    case 'npm':
    default:
      return { command: 'npx', args: ['--no-install', 'tsc', '--noEmit'] };
  }
}

@Injectable()
export class ValidationPlanResolver {
  constructor(private readonly toolingDetector: RepositoryToolingDetector) {}

  async resolve(
    expectations: TaskValidationExpectation[],
    workspacePath: string,
  ): Promise<ValidationCheck[]> {
    const tooling = await this.toolingDetector.detect(workspacePath);
    const checks: ValidationCheck[] = [];
    for (const expectation of expectations) {
      checks.push(...this.resolveOne(expectation, tooling.packages));
    }
    return checks;
  }

  private resolveOne(
    expectation: TaskValidationExpectation,
    packages: DetectedPackage[],
  ): ValidationCheck[] {
    const checkType = EXPECTATION_TO_CHECK_TYPE[expectation.type] ?? undefined;

    if (checkType === undefined || checkType === null) {
      return [
        {
          type: ValidationCheckType.CUSTOM,
          name: `${expectation.description} (${expectation.type})`,
          command: '',
          args: [],
          workingDirectory: null,
          required: expectation.required,
          unavailableReason:
            expectation.type === 'manual'
              ? 'This is a manual check and cannot be run automatically.'
              : 'This validation type has no automatically resolvable command.',
        },
      ];
    }

    const matches: ValidationCheck[] = [];
    for (const pkg of packages) {
      const aliases = SCRIPT_ALIASES[checkType] ?? [];
      const scriptName = aliases.find((alias) =>
        Object.prototype.hasOwnProperty.call(pkg.scripts, alias),
      );

      if (scriptName) {
        const { command, args } = commandForScript(
          pkg.packageManager,
          scriptName,
        );
        matches.push({
          type: checkType,
          name: `${this.packageLabel(pkg)} ${CHECK_TYPE_LABEL[checkType].toLowerCase()}`,
          command,
          args,
          workingDirectory: pkg.dir === '.' ? null : pkg.dir,
          required: expectation.required,
        });
        continue;
      }

      if (
        checkType === ValidationCheckType.TYPECHECK &&
        pkg.hasTsconfig &&
        pkg.hasTypescriptDependency
      ) {
        const { command, args } = commandForTscFallback(pkg.packageManager);
        matches.push({
          type: checkType,
          name: `${this.packageLabel(pkg)} typecheck (tsc)`,
          command,
          args,
          workingDirectory: pkg.dir === '.' ? null : pkg.dir,
          required: expectation.required,
        });
      }
    }

    if (matches.length === 0) {
      return [
        {
          type: checkType,
          name: `${CHECK_TYPE_LABEL[checkType]} (unavailable)`,
          command: '',
          args: [],
          workingDirectory: null,
          required: expectation.required,
          unavailableReason:
            'No matching script or safely-inferrable tool was found in the repository.',
        },
      ];
    }

    return matches;
  }

  private packageLabel(pkg: DetectedPackage): string {
    if (pkg.name === 'root') return 'Repository';
    return pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1);
  }
}
