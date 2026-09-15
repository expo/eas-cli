import { TaskDefinition, TaskResult } from './types';

export class TaskGraphDefinitionError extends Error {}

export interface TaskGraphExecution {
  results: Map<string, TaskResult>;
  /** Set when a `fail-session` task failed or the graph was aborted from outside. */
  fatalError: unknown;
}

/**
 * Runs tasks as soon as their dependencies allow, concurrently.
 *
 * A task starts when every `needs` task succeeded and every `after` task has
 * finished. A task whose `needs` include a failed or skipped task is skipped.
 * A failed `fail-session` task, or an aborted `signal`, stops the graph: no new
 * task starts, running tasks see the aborted context signal, and the execution
 * resolves once they have settled. The caller decides what to do with
 * `fatalError`; the graph itself never throws for task failures.
 */
export async function executeTaskGraphAsync<TContext>(
  tasks: readonly TaskDefinition<TContext>[],
  {
    signal,
    createContext,
    onTaskStart,
    onTaskFinish,
  }: {
    signal: AbortSignal;
    createContext: (task: TaskDefinition<TContext>, signal: AbortSignal) => TContext;
    onTaskStart?: (task: TaskDefinition<TContext>) => void;
    onTaskFinish?: (task: TaskDefinition<TContext>, result: TaskResult) => void;
  }
): Promise<TaskGraphExecution> {
  validateTaskGraph(tasks);

  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const results = new Map<string, TaskResult>();
  const pending = new Set(tasks.map(task => task.id));
  const running = new Map<string, Promise<void>>();
  const graphAbortController = new AbortController();
  const taskSignal = AbortSignal.any([signal, graphAbortController.signal]);
  let fatalError: unknown;
  let hasFatalError = false;

  const recordFatalError = (error: unknown): void => {
    if (!hasFatalError) {
      hasFatalError = true;
      fatalError = error;
      graphAbortController.abort(error);
    }
  };

  const settle = (task: TaskDefinition<TContext>, result: TaskResult): void => {
    results.set(task.id, result);
    pending.delete(task.id);
    onTaskFinish?.(task, result);
  };

  const skip = (task: TaskDefinition<TContext>, skipReason: string): void => {
    settle(task, { id: task.id, outcome: 'skipped', durationMs: 0, skipReason });
  };

  const start = (task: TaskDefinition<TContext>): void => {
    pending.delete(task.id);
    onTaskStart?.(task);
    const startedAt = Date.now();
    const promise = (async () => {
      try {
        await task.run(createContext(task, taskSignal));
        settle(task, { id: task.id, outcome: 'success', durationMs: Date.now() - startedAt });
      } catch (error) {
        settle(task, { id: task.id, outcome: 'failed', durationMs: Date.now() - startedAt, error });
        if (task.onFailure === 'fail-session') {
          recordFatalError(error);
        }
      } finally {
        running.delete(task.id);
      }
    })();
    running.set(task.id, promise);
  };

  const onAbort = (): void => {
    recordFatalError(signal.reason ?? new Error('The device run session was aborted.'));
  };
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (pending.size > 0 || running.size > 0) {
      // Settle every task that can be decided without running anything, then
      // start every task that is ready. Repeat until nothing changes.
      let changed = true;
      while (changed) {
        changed = false;
        for (const id of [...pending]) {
          const task = tasksById.get(id)!;
          if (hasFatalError) {
            skip(task, 'the session failed before this task could start');
            changed = true;
            continue;
          }
          const blockedBy = (task.needs ?? []).find(need => {
            const result = results.get(need);
            return result !== undefined && result.outcome !== 'success';
          });
          if (blockedBy !== undefined) {
            skip(task, `"${blockedBy}" did not succeed`);
            changed = true;
            continue;
          }
          const isReady =
            (task.needs ?? []).every(need => results.get(need)?.outcome === 'success') &&
            (task.after ?? []).every(dependency => results.has(dependency));
          if (isReady) {
            start(task);
            changed = true;
          }
        }
      }

      if (running.size === 0) {
        // Only possible with a dependency on a task that never settles, which
        // validation rules out. Fail loudly rather than hang.
        for (const id of [...pending]) {
          skip(tasksById.get(id)!, 'no path to start this task');
        }
        break;
      }
      await Promise.race(running.values());
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  return { results, fatalError };
}

/** Rejects duplicate ids, unknown dependencies, and cycles. */
export function validateTaskGraph<TContext>(tasks: readonly TaskDefinition<TContext>[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new TaskGraphDefinitionError(`Task "${task.id}" is defined twice.`);
    }
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of [...(task.needs ?? []), ...(task.after ?? [])]) {
      if (!ids.has(dependency)) {
        throw new TaskGraphDefinitionError(
          `Task "${task.id}" depends on "${dependency}", which is not defined.`
        );
      }
    }
  }

  // Kahn's algorithm: every task must be reachable from the roots.
  const remainingDependencies = new Map(
    tasks.map(task => [task.id, new Set([...(task.needs ?? []), ...(task.after ?? [])])])
  );
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of remainingDependencies.get(task.id)!) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id]);
    }
  }
  const ready = tasks.filter(task => remainingDependencies.get(task.id)!.size === 0).map(t => t.id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop()!;
    visited += 1;
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = remainingDependencies.get(dependent)!;
      remaining.delete(id);
      if (remaining.size === 0) {
        ready.push(dependent);
      }
    }
  }
  if (visited !== tasks.length) {
    const cyclic = [...remainingDependencies.entries()]
      .filter(([, remaining]) => remaining.size > 0)
      .map(([id]) => id);
    throw new TaskGraphDefinitionError(
      `Tasks form a dependency cycle: ${cyclic.map(id => `"${id}"`).join(', ')}.`
    );
  }
}
