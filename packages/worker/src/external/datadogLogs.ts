import { bunyan } from '@expo/logger';

interface DatadogLogsOptions {
  apiKey: string | null;
  site: string;
  service: string;
  logger: bunyan;
}

class DatadogLogs {
  private readonly apiKey: string | null;
  private readonly endpoint: string;
  private readonly service: string;
  private readonly logger: bunyan;

  constructor(options: DatadogLogsOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = `https://http-intake.logs.${options.site}/api/v2/logs`;
    this.service = options.service;
    this.logger = options.logger;
  }

  async send(log: {
    message: string;
    level: 'error' | 'warn' | 'info';
    tags: Record<string, string>;
  }): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.apiKey,
        },
        body: JSON.stringify([
          {
            message: log.message,
            ddsource: 'eas-build-worker',
            ddtags: Object.entries(log.tags)
              .map(([k, v]) => `${k}:${v}`)
              .join(','),
            status: log.level,
            service: this.service,
          },
        ]),
      });
    } catch (error) {
      this.logger.error(error, 'Failed to send log to Datadog');
    }
  }
}

export default DatadogLogs;
