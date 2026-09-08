import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The single place that reads JOB_* env vars — mirrors
// PlanningAIConfigService's role for the AI provider config.
@Injectable()
export class JobsConfigService {
  readonly workerEnabled: boolean;
  readonly isTestEnv: boolean;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly lockTimeoutSeconds: number;
  readonly heartbeatSeconds: number;
  readonly defaultMaxAttempts: number;
  readonly retryBaseDelaySeconds: number;
  readonly retryMaxDelaySeconds: number;
  readonly maxPayloadBytes: number;
  readonly maxResultBytes: number;

  constructor(config: ConfigService) {
    this.workerEnabled = config.get<boolean>('JOB_WORKER_ENABLED')!;
    this.isTestEnv = config.get<string>('NODE_ENV') === 'test';
    this.pollIntervalMs = config.get<number>('JOB_POLL_INTERVAL_MS')!;
    this.batchSize = config.get<number>('JOB_BATCH_SIZE')!;
    this.lockTimeoutSeconds = config.get<number>('JOB_LOCK_TIMEOUT_SECONDS')!;
    this.heartbeatSeconds = config.get<number>('JOB_HEARTBEAT_SECONDS')!;
    this.defaultMaxAttempts = config.get<number>('JOB_DEFAULT_MAX_ATTEMPTS')!;
    this.retryBaseDelaySeconds = config.get<number>(
      'JOB_RETRY_BASE_DELAY_SECONDS',
    )!;
    this.retryMaxDelaySeconds = config.get<number>(
      'JOB_RETRY_MAX_DELAY_SECONDS',
    )!;
    this.maxPayloadBytes = config.get<number>('JOB_MAX_PAYLOAD_BYTES')!;
    this.maxResultBytes = config.get<number>('JOB_MAX_RESULT_BYTES')!;
  }
}
