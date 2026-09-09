import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The single place that reads TASK_EXECUTION_* env vars.
@Injectable()
export class TaskExecutionConfigService {
  readonly maxDiffChars: number;

  constructor(config: ConfigService) {
    this.maxDiffChars = config.get<number>('TASK_EXECUTION_MAX_DIFF_CHARS')!;
  }
}
