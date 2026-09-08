import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The single place that reads WORKSPACE_*/GIT_* env vars — mirrors
// PlanningAIConfigService/JobsConfigService's role for their own domains.
@Injectable()
export class WorkspaceConfigService {
  readonly workspaceRoot: string;
  readonly maxSizeMb: number;
  readonly commandTimeoutMs: number;
  readonly cloneTimeoutMs: number;
  readonly defaultBranch: string;
  readonly maxOutputBytes: number;
  readonly authorName: string;
  readonly authorEmail: string;

  // Fixed, not configurable: a single deterministic branch name keeps the
  // policy simple (one workspace, one development branch — see the module
  // README-style comment on ProjectWorkspace) and avoids ever deriving a
  // branch name from unsanitized Project input.
  readonly developmentBranch = 'autodev/development';

  constructor(config: ConfigService) {
    this.workspaceRoot = config.get<string>('WORKSPACE_ROOT')!;
    this.maxSizeMb = config.get<number>('WORKSPACE_MAX_SIZE_MB')!;
    this.commandTimeoutMs = config.get<number>('GIT_COMMAND_TIMEOUT_MS')!;
    this.cloneTimeoutMs = config.get<number>('GIT_CLONE_TIMEOUT_MS')!;
    this.defaultBranch = config.get<string>('GIT_DEFAULT_BRANCH')!;
    this.maxOutputBytes = config.get<number>('GIT_MAX_OUTPUT_BYTES')!;
    this.authorName = config.get<string>('GIT_AUTHOR_NAME')!;
    this.authorEmail = config.get<string>('GIT_AUTHOR_EMAIL')!;
  }
}
