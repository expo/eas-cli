import { type bunyan } from '@expo/logger';

export type StartupTasks = {
  /**
   * Starts `fn` now and returns its promise. Logs when it starts, when it finishes, and
   * how long it took, so the timing of each part stays visible when parts run in
   * parallel inside one step.
   *
   * The returned promise is marked as handled: a task that fails before anything awaits
   * it must not crash the worker (it has no unhandledRejection handler). Awaiting the
   * promise still throws the error.
   */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** One line with the duration of every finished task, in the order they finished. */
  summary(): string;
};

export function createStartupTasks(logger: bunyan): StartupTasks {
  const startedAt = Date.now();
  const finished: { name: string; ms: number }[] = [];
  return {
    run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const taskStartedAt = Date.now();
      logger.info(`Starting ${name}.`);
      const promise = (async () => {
        try {
          const result = await fn();
          const ms = Date.now() - taskStartedAt;
          finished.push({ name, ms });
          logger.info(`Finished ${name} in ${formatSeconds(ms)}.`);
          return result;
        } catch (err) {
          logger.warn(`${name} failed after ${formatSeconds(Date.now() - taskStartedAt)}.`);
          throw err;
        }
      })();
      promise.catch(() => {});
      return promise;
    },
    summary(): string {
      const parts = finished.map(({ name, ms }) => `${name} ${formatSeconds(ms)}`);
      return `Startup took ${formatSeconds(Date.now() - startedAt)} (${parts.join(', ')}).`;
    },
  };
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
