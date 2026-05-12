import * as sentryNode from '@sentry/node';

let isSetup = false;

export const Sentry = {
  setup({
    dsn,
    environment,
    tags,
  }: {
    dsn: string | null;
    environment: string;
    tags?: Record<string, string>;
  }): void {
    if (dsn) {
      sentryNode.init({
        dsn,
        environment,
        ...(tags ? { initialScope: { tags } } : {}),
      });
    }
    isSetup = true;
  },

  captureMessage(
    msg: string,
    err?: Error,
    options: {
      tags?: Record<string, string>;
      extras?: Record<string, unknown>;
      level?: sentryNode.SeverityLevel;
    } = {}
  ): void {
    if (!isSetup) {
      return;
    }

    sentryNode.withScope(scope => {
      if (options.tags) {
        scope.setTags(options.tags);
      }
      if (options.extras) {
        scope.setExtras(options.extras);
      }
      if (err) {
        scope.setExtra('err', err);
      }
      if (options.level) {
        scope.setLevel(options.level);
      }
      sentryNode.captureMessage(msg);
    });
  },

  flush(timeoutMs: number = 2000): Promise<boolean> {
    if (!isSetup) {
      return Promise.resolve(true);
    }
    return sentryNode.flush(timeoutMs);
  },

  /** @internal — for tests only. Do not call from production code. */
  _resetForTest(): void {
    isSetup = false;
  },
};
