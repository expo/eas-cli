import { bunyan } from '@expo/logger';

import { createStartupTasks } from '../startupTasks';

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
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
});
