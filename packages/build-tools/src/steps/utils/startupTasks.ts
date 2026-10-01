import { type bunyan } from '@expo/logger';

export type StartupTasks = {
  /**
   * Aborted when the first task fails, with that task's error as the reason. Long or
   * unbounded work (for example a download) passes it on, and tasks check it before
   * each next stage, so a failed startup stops quickly and does no more work.
   */
  readonly signal: AbortSignal;
  /**
   * Starts `fn` now and returns its promise. Logs when it starts, when it finishes, and
   * how long it took, so the timing of each part stays visible when parts run in
   * parallel inside one step. `fn` gets a child logger with a `startupTask` field, so
   * the interleaved lines of parallel tasks can be told apart.
   *
   * If the task fails, startup is aborted. The returned promise is marked as handled: a
   * task that fails before anything awaits it must not crash the worker (it has no
   * unhandledRejection handler). Awaiting the promise still throws the error.
   */
  run<T>(name: string, fn: (taskLogger: bunyan) => Promise<T>): Promise<T>;
  /**
   * Resolves like `promise`, or rejects with the abort reason as soon as startup is
   * aborted. For waiting on work that cannot be cancelled, such as a device boot. The
   * returned promise is marked as handled.
   */
  untilAborted<T>(promise: Promise<T>): Promise<T>;
  /** Aborts startup, for a failure outside of `run`. The first reason wins. */
  abort(reason: unknown): void;
  /** One line with the duration of every finished task, in the order they finished. */
  summary(): string;
};

export function createStartupTasks(logger: bunyan): StartupTasks {
  const startedAt = Date.now();
  const finished: { name: string; ms: number }[] = [];
  const controller = new AbortController();
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  return {
    signal: controller.signal,
    run<T>(name: string, fn: (taskLogger: bunyan) => Promise<T>): Promise<T> {
      const taskStartedAt = Date.now();
      logger.info(`Starting ${name}.`);
      const promise = (async () => {
        try {
          const result = await fn(logger.child({ startupTask: name }));
          const ms = Date.now() - taskStartedAt;
          finished.push({ name, ms });
          logger.info(`Finished ${name} in ${formatSeconds(ms)}.`);
          return result;
        } catch (err) {
          logger.warn(`${name} failed after ${formatSeconds(Date.now() - taskStartedAt)}.`);
          abort(err);
          throw err;
        }
      })();
      promise.catch(() => {});
      return promise;
    },
    untilAborted<T>(promise: Promise<T>): Promise<T> {
      const { signal } = controller;
      const result = new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = (): void => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
          value => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          err => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          }
        );
      });
      result.catch(() => {});
      return result;
    },
    abort,
    summary(): string {
      const parts = finished.map(({ name, ms }) => `${name} ${formatSeconds(ms)}`);
      return `Startup took ${formatSeconds(Date.now() - startedAt)} (${parts.join(', ')}).`;
    },
  };
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
