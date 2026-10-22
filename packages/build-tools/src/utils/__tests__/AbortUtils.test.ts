import { AbortUtils } from '../AbortUtils';

describe(AbortUtils.resettableTimeout, () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts with a TimeoutError when the deadline expires', () => {
    const { signal } = AbortUtils.resettableTimeout(100);

    jest.advanceTimersByTime(99);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal.reason).toMatchObject({
      name: 'TimeoutError',
      message: 'The operation timed out after 100ms.',
    });
  });

  it('restarts the deadline from the last reset', () => {
    const { signal, resetDeadline } = AbortUtils.resettableTimeout(100);

    jest.advanceTimersByTime(80);
    resetDeadline();
    jest.advanceTimersByTime(80);
    resetDeadline();
    jest.advanceTimersByTime(99);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
  });

  it('does not rearm the deadline after it expired', () => {
    const { resetDeadline } = AbortUtils.resettableTimeout(100);

    jest.advanceTimersByTime(100);
    resetDeadline();
    expect(jest.getTimerCount()).toBe(0);
  });
});
