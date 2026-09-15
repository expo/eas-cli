import { TaskGraphDefinitionError, executeTaskGraphAsync, validateTaskGraph } from '../graph';
import { TaskDefinition, TaskResult } from '../types';

type Context = { signal: AbortSignal };

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function task(
  id: string,
  overrides: Partial<TaskDefinition<Context>> & { run?: TaskDefinition<Context>['run'] } = {}
): TaskDefinition<Context> {
  return {
    id,
    displayName: id,
    onFailure: 'fail-session',
    run: async () => {},
    ...overrides,
  };
}

async function runGraphAsync(
  tasks: TaskDefinition<Context>[],
  { signal = new AbortController().signal }: { signal?: AbortSignal } = {}
): Promise<{ results: Map<string, TaskResult>; fatalError: unknown; order: string[] }> {
  const order: string[] = [];
  const execution = await executeTaskGraphAsync(tasks, {
    signal,
    createContext: (_task, taskSignal) => ({ signal: taskSignal }),
    onTaskStart: started => order.push(started.id),
  });
  return { ...execution, order };
}

describe(validateTaskGraph, () => {
  it('rejects duplicate ids', () => {
    expect(() => validateTaskGraph([task('a'), task('a')])).toThrow(TaskGraphDefinitionError);
  });

  it('rejects unknown dependencies', () => {
    expect(() => validateTaskGraph([task('a', { needs: ['missing'] })])).toThrow(
      /depends on "missing"/
    );
  });

  it('rejects cycles', () => {
    expect(() =>
      validateTaskGraph([task('a', { needs: ['b'] }), task('b', { after: ['a'] })])
    ).toThrow(/cycle/);
  });

  it('accepts a diamond', () => {
    expect(() =>
      validateTaskGraph([
        task('root'),
        task('left', { needs: ['root'] }),
        task('right', { needs: ['root'] }),
        task('join', { needs: ['left', 'right'] }),
      ])
    ).not.toThrow();
  });
});

describe(executeTaskGraphAsync, () => {
  it('runs independent tasks concurrently and dependents after their needs', async () => {
    const bootGate = deferred();
    const downloadGate = deferred();
    let installStartedAt: number | undefined;
    const tasks = [
      task('boot', { run: () => bootGate.promise }),
      task('download', { run: () => downloadGate.promise }),
      task('install', {
        needs: ['boot', 'download'],
        run: async () => {
          installStartedAt = Date.now();
        },
      }),
    ];

    const execution = runGraphAsync(tasks);
    // Give the scheduler a tick to start the roots.
    await new Promise(resolve => setImmediate(resolve));
    expect(installStartedAt).toBeUndefined();
    bootGate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(installStartedAt).toBeUndefined();
    downloadGate.resolve();

    const { results, fatalError, order } = await execution;
    expect(fatalError).toBeUndefined();
    expect(order.slice(0, 2).sort()).toEqual(['boot', 'download']);
    expect(order[2]).toBe('install');
    expect([...results.values()].map(result => result.outcome)).toEqual([
      'success',
      'success',
      'success',
    ]);
  });

  it('waits for "after" dependencies to finish with any outcome', async () => {
    const tasks = [
      task('launch', {
        onFailure: 'degrade-application',
        run: async () => {
          throw new Error('no app');
        },
      }),
      task('publish', { after: ['launch'] }),
    ];
    const { results, fatalError, order } = await runGraphAsync(tasks);
    expect(fatalError).toBeUndefined();
    expect(order).toEqual(['launch', 'publish']);
    expect(results.get('launch')?.outcome).toBe('failed');
    expect(results.get('publish')?.outcome).toBe('success');
  });

  it('skips tasks whose needs failed and keeps the rest of the session going', async () => {
    const tasks = [
      task('boot'),
      task('download', {
        onFailure: 'degrade-application',
        run: async () => {
          throw new Error('404');
        },
      }),
      task('install', { needs: ['boot', 'download'], onFailure: 'degrade-application' }),
      task('launch', { needs: ['install'], onFailure: 'degrade-application' }),
      task('preview', { needs: ['boot'] }),
      task('publish', { needs: ['preview'], after: ['launch'] }),
      task('hold', { needs: ['publish'] }),
    ];
    const { results, fatalError } = await runGraphAsync(tasks);
    expect(fatalError).toBeUndefined();
    expect(results.get('download')?.outcome).toBe('failed');
    expect(results.get('install')).toMatchObject({
      outcome: 'skipped',
      skipReason: '"download" did not succeed',
    });
    expect(results.get('launch')).toMatchObject({
      outcome: 'skipped',
      skipReason: '"install" did not succeed',
    });
    expect(results.get('publish')?.outcome).toBe('success');
    expect(results.get('hold')?.outcome).toBe('success');
  });

  it('stops the graph when a fail-session task fails', async () => {
    const error = new Error('boot failed');
    const slowGate = deferred();
    let observedAbort = false;
    const tasks = [
      task('boot', {
        run: async () => {
          throw error;
        },
      }),
      task('slow', {
        onFailure: 'warn',
        run: async ({ signal }) => {
          signal.addEventListener('abort', () => {
            observedAbort = true;
            slowGate.resolve();
          });
          await slowGate.promise;
        },
      }),
      task('install', { needs: ['boot'] }),
      task('publish', { after: ['slow'] }),
    ];
    const { results, fatalError } = await runGraphAsync(tasks);
    expect(fatalError).toBe(error);
    expect(observedAbort).toBe(true);
    expect(results.get('boot')?.outcome).toBe('failed');
    expect(results.get('slow')?.outcome).toBe('success');
    expect(results.get('install')?.outcome).toBe('skipped');
    expect(results.get('publish')).toMatchObject({
      outcome: 'skipped',
      skipReason: 'the session failed before this task could start',
    });
  });

  it('does not treat warn or degrade failures as fatal', async () => {
    const tasks = [
      task('prefetch', {
        onFailure: 'warn',
        run: async () => {
          throw new Error('npm down');
        },
      }),
      task('preview', { after: ['prefetch'] }),
    ];
    const { results, fatalError } = await runGraphAsync(tasks);
    expect(fatalError).toBeUndefined();
    expect(results.get('prefetch')?.outcome).toBe('failed');
    expect(results.get('preview')?.outcome).toBe('success');
  });

  it('aborts when the outside signal aborts and skips what has not started', async () => {
    const controller = new AbortController();
    const holdGate = deferred();
    const tasks = [
      task('hold', {
        run: async ({ signal }) => {
          signal.addEventListener('abort', () => holdGate.resolve());
          await holdGate.promise;
        },
      }),
      task('later', { needs: ['hold'] }),
    ];
    const execution = runGraphAsync(tasks, { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    const reason = new Error('worker cancelled the job');
    controller.abort(reason);
    const { results, fatalError } = await execution;
    expect(fatalError).toBe(reason);
    expect(results.get('hold')?.outcome).toBe('success');
    expect(results.get('later')?.outcome).toBe('skipped');
  });

  it('reports durations and calls finish hooks once per task', async () => {
    const finished: string[] = [];
    const execution = await executeTaskGraphAsync([task('a'), task('b', { needs: ['a'] })], {
      signal: new AbortController().signal,
      createContext: (_task, signal) => ({ signal }),
      onTaskFinish: (finishedTask, result) => {
        finished.push(finishedTask.id);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      },
    });
    expect(finished).toEqual(['a', 'b']);
    expect(execution.results.size).toBe(2);
  });
});
