import { bunyan } from '@expo/logger';

import { createStartupTasks } from '../startupTasks';

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as bunyan;
}

describe(createStartupTasks, () => {
  it('logs each task and sums them up in the order they finished', async () => {
    const logger = createLoggerMock();
    const tasks = createStartupTasks(logger);

    let finishSlow!: () => void;
    const slow = tasks.run(
      'slow task',
      () =>
        new Promise<string>(resolve => {
          finishSlow = () => resolve('slow');
        })
    );
    const fast = tasks.run('fast task', async () => 'fast');

    await expect(fast).resolves.toBe('fast');
    finishSlow();
    await expect(slow).resolves.toBe('slow');

    expect(logger.info).toHaveBeenCalledWith('Starting slow task.');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^Finished fast task in \d+\.\d s\.$/)
    );
    expect(tasks.summary()).toMatch(
      /^Startup took \d+\.\d s \(fast task \d+\.\d s, slow task \d+\.\d s\)\.$/
    );
  });

  it('keeps the error for awaiters without an unhandled rejection', async () => {
    const logger = createLoggerMock();
    const tasks = createStartupTasks(logger);

    const failing = tasks.run('failing task', async () => {
      throw new Error('boom');
    });
    // Nothing awaits the task yet. Jest fails the test on an unhandled rejection.
    await new Promise(resolve => setImmediate(resolve));

    await expect(failing).rejects.toThrow('boom');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^failing task failed after/));
    expect(tasks.summary()).toMatch(/\(\)\.$/);
  });

  it('aborts the signal with the first failure and gives each task a child logger', async () => {
    const logger = createLoggerMock();
    const tasks = createStartupTasks(logger);

    let taskLogger: unknown;
    await tasks.run('named task', async l => {
      taskLogger = l;
    });
    expect(logger.child).toHaveBeenCalledWith({ startupTask: 'named task' });
    expect(taskLogger).toBe(logger);
    expect(tasks.signal.aborted).toBe(false);

    const first = new Error('first failure');
    await expect(tasks.run('first', async () => Promise.reject(first))).rejects.toBe(first);
    await expect(
      tasks.run('second', async () => Promise.reject(new Error('second failure')))
    ).rejects.toThrow('second failure');
    expect(tasks.signal.aborted).toBe(true);
    expect(tasks.signal.reason).toBe(first);
  });

  it('stops waiting on untilAborted when startup is aborted', async () => {
    const tasks = createStartupTasks(createLoggerMock());
    const never = new Promise<void>(() => {});
    const waiting = tasks.untilAborted(never);
    const failure = new Error('boot failed');

    tasks.abort(failure);

    await expect(waiting).rejects.toBe(failure);
    await expect(tasks.untilAborted(Promise.resolve('late'))).rejects.toBe(failure);
    await expect(
      createStartupTasks(createLoggerMock()).untilAborted(Promise.resolve('ok'))
    ).resolves.toBe('ok');
  });
  it.each([false, true])(
    'inherits parent cancellation, already aborted=%s',
    async alreadyAborted => {
      const parent = new AbortController();
      const reason = new Error('cancelled');
      if (alreadyAborted) {
        parent.abort(reason);
      }
      const tasks = createStartupTasks(createLoggerMock(), parent.signal);
      const waiting = tasks.untilAborted(new Promise<void>(() => {}));
      if (!alreadyAborted) {
        parent.abort(reason);
      }
      await expect(waiting).rejects.toBe(reason);
      expect(tasks.signal.reason).toBe(reason);
      tasks.abort(new Error('later failure'));
      expect(tasks.signal.reason).toBe(reason);
    }
  );
});
