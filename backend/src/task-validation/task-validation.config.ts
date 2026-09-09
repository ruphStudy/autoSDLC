import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The single place that reads VALIDATION_* env vars.
@Injectable()
export class TaskValidationConfigService {
  readonly commandTimeoutMs: number;
  readonly maxOutputBytes: number;

  constructor(config: ConfigService) {
    this.commandTimeoutMs = config.get<number>(
      'VALIDATION_COMMAND_TIMEOUT_MS',
    )!;
    this.maxOutputBytes = config.get<number>('VALIDATION_MAX_OUTPUT_BYTES')!;
  }
}
