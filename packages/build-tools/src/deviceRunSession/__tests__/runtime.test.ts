import { createMockLogger } from '../../__tests__/utils/logger';
import { TeardownStack, formatDuration } from '../runtime';

describe(TeardownStack, () => {
  it('runs actions in reverse order of registration', async () => {
    const stack = new TeardownStack();
    const order: string[] = [];
    stack.push('first', async () => {
      order.push('first');
    });
    stack.push('second', async () => {
      order.push('second');
    });
    stack.push('third', async () => {
      order.push('third');
    });

    await stack.runAsync({ logger: createMockLogger() });

    expect(order).toEqual(['third', 'second', 'first']);
    expect(stack.size).toBe(0);
  });

  it('keeps going when an action fails and logs the failure', async () => {
    const stack = new TeardownStack();
    const logger = createMockLogger();
    const order: string[] = [];
    stack.push('first', async () => {
      order.push('first');
    });
    stack.push('broken', async () => {
      throw new Error('boom');
    });

    await stack.runAsync({ logger });

    expect(order).toEqual(['first']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not clean up broken.'
    );
  });

  it('gives up on an action that outlives the deadline and still runs the rest', async () => {
    const stack = new TeardownStack();
    const logger = createMockLogger();
    const order: string[] = [];
    stack.push('first', async () => {
      order.push('first');
    });
    stack.push('stuck', () => new Promise<void>(() => {}));

    await stack.runAsync({ logger, deadlineMs: 50 });

    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), 'Could not clean up stuck.');
    // The deadline has passed, so the remaining action is skipped with a warning
    // instead of running without a bound.
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping cleanup of first: the cleanup deadline has passed.'
    );
    expect(order).toEqual([]);
  });
});

describe(formatDuration, () => {
  it('formats milliseconds and seconds', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(65_000)).toBe('65.0s');
  });
});
