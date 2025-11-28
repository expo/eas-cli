import { bunyan } from '@expo/logger';
import * as sentry from '@sentry/node';
import Flatted from 'flatted';
import { ZodError } from 'zod';
import Router from 'koa-router';
import { boomify } from '../utils/boom';

interface SentryOptions {
  dsn: string | null;
  environment: string;
  tags?: Record<string, string>;
  logger: bunyan;
}

interface ErrorOptions {
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
  logger?: bunyan;
  level?: sentry.SeverityLevel;
}

class Sentry {
  private readonly logger: bunyan;

  constructor(private readonly options: SentryOptions) {
    this.logger = options.logger;
    sentry.init({
      ...(options.dsn ? { dsn: options.dsn } : {}),
      environment: options.environment,
    });
  }

  public getMiddleware(options: ErrorOptions = {}) {
    return async (ctx: Router.RouterContext, next: () => Promise<void>): Promise<void> => {
      try {
        await next();
      } catch (err: any) {
        if (ctx.status >= 500) {
          sentry.withScope((scope: sentry.Scope) => {
            scope.addEventProcessor((event: sentry.Event) =>
              sentry.Handlers.parseRequest(event, ctx.req)
            );
            scope.setTags({
              component: 'api',
              ...this.options.tags,
              ...options.tags,
              path: ctx.path,
            });
            scope.setExtras(options.extras ?? {});
            sentry.captureException(err);
          });
        }
        this.logger.error({ err });
      }
    };
  }

  public handleError(msg: string, err?: Error, options: ErrorOptions = {}): void {
    const l = options.logger ?? this.logger;
    const tags = { ...this.options.tags, ...options.tags };
    const extras = options.extras ?? {};

    // TurtleErrors don't need the explanatory ${msg} prefix,
    // because their message should already be user-facing.
    // ZodError#message can't be modified, so we don't reassign either.
    if (err instanceof Error && !(err instanceof ZodError)) {
      err.message = `${msg}\n${err.message}`;
    }

    const boom = err instanceof Error ? boomify(err) : err;
    l.error({ tags, extras, err: boom }, msg);

    sentry.withScope((scope: sentry.Scope) => {
      scope.setTags(tags);
      scope.setExtras(extras);
      if (options?.level) {
        scope.setLevel(options?.level);
      }
      if (err instanceof Error) {
        sentry.captureException(err);
      } else {
        let serializedErr;
        try {
          serializedErr = JSON.stringify(err);
        } catch {
          serializedErr = Flatted.stringify(err);
        }
        const sentryMessage = err ? `${msg}\n${serializedErr}` : msg;
        sentry.captureMessage(sentryMessage);
      }
    });
  }

  public handleCritical(msg: string, err?: Error, options: ErrorOptions = {}): void {
    this.handleError(`Critical error, might require an urgent action [${msg}]`, err, {
      ...options,
      tags: { ...options.tags, severity: 'critical' },
    });
  }
}

export default Sentry;
