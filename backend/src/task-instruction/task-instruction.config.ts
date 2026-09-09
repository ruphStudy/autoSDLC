import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The single place that reads TASK_CONTEXT_*/TASK_INSTRUCTION_* env vars.
@Injectable()
export class TaskInstructionConfigService {
  readonly maxTreeEntries: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly recentCommits: number;
  readonly maxInstructionChars: number;

  constructor(config: ConfigService) {
    this.maxTreeEntries = config.get<number>('TASK_CONTEXT_MAX_TREE_ENTRIES')!;
    this.maxFiles = config.get<number>('TASK_CONTEXT_MAX_FILES')!;
    this.maxFileBytes = config.get<number>('TASK_CONTEXT_MAX_FILE_BYTES')!;
    this.maxTotalBytes = config.get<number>('TASK_CONTEXT_MAX_TOTAL_BYTES')!;
    this.recentCommits = config.get<number>('TASK_CONTEXT_RECENT_COMMITS')!;
    this.maxInstructionChars = config.get<number>(
      'TASK_INSTRUCTION_MAX_CHARS',
    )!;
  }
}
