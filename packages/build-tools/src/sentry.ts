import * as sentryNode from '@sentry/node';

type CaptureOptions = {
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
  level?: sentryNode.SeverityLevel;
};

type SentryAPI = {
  setup(opts: { dsn: string | null; environment: string; tags?: Record<string, string> }): void;
  capture(msg: string, options?: CaptureOptions): void;
  capture(msg: string, err: Error | undefined, options?: CaptureOptions): void;
  capture(err: Error, options?: CaptureOptions): void;
  flush(timeoutMs?: number): Promise<boolean>;
};

export const Sentry: SentryAPI = {
  setup({ dsn, environment, tags }) {
    if (dsn) {
      sentryNode.init({
        dsn,
        environment,
        ...(tags ? { initialScope: { tags } } : {}),
      });
    }
  },

  capture(arg1: string | Error, arg2?: Error | CaptureOptions, arg3?: CaptureOptions): void {
    let msg: string | undefined;
    let err: Error | undefined;
    let options: CaptureOptions = {};

    if (arg1 instanceof Error) {
      err = arg1;
      options = (arg2 as CaptureOptions | undefined) ?? {};
    } else {
      msg = arg1;
      if (arg3 !== undefined) {
        // 3-arg form: arg2 unambiguously means err (null/undefined → no err)
        options = arg3;
        if (arg2 !== undefined && arg2 !== null) {
          err = arg2 instanceof Error ? arg2 : new Error(String(arg2));
        }
      } else if (arg2 instanceof Error) {
        err = arg2;
      } else if (arg2 !== undefined && arg2 !== null) {
        // 2-arg form: non-Error object → options; primitive → coerced err
        if (typeof arg2 === 'object') {
          options = arg2;
        } else {
          err = new Error(String(arg2));
        }
      }
    }

    sentryNode.withScope(scope => {
      if (options.tags) {
        scope.setTags(options.tags);
      }
      if (options.extras) {
        scope.setExtras(options.extras);
      }
      if (options.level) {
        scope.setLevel(options.level);
      }

      if (err) {
        if (msg && err.message !== msg) {
          scope.setExtra('message', msg);
        }
        sentryNode.captureException(err);
      } else if (msg) {
        sentryNode.captureMessage(msg);
      }
    });
  },

  flush(timeoutMs: number = 2000): Promise<boolean> {
    return sentryNode.flush(timeoutMs);
  },
};
