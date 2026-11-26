import { retryAsync } from '../retry';

describe(retryAsync, () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops immediately without scheduling a retry timer when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('deterministic error'));

    await expect(
      retryAsync(fn, {
        retryOptions: { retries: 5, retryIntervalMs: 10_000 },
        shouldRetry: () => false,
      })
    ).rejects.toThrow('deterministic error');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('wakes immediately from retry sleep and clears the timer when AbortSignal aborts', async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockRejectedValue(new Error('transient error'));

    const promise = retryAsync(fn, {
      retryOptions: { retries: 5, retryIntervalMs: 10_000 },
      signal: controller.signal,
    });
    const rejection = expect(promise).rejects.toThrow('transient error');

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    controller.abort(new Error('emulator exited'));
    await rejection;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries up to the configured limit when shouldRetry returns true', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('attempt 1')).mockResolvedValueOnce('ok');

    const promise = retryAsync(fn, {
      retryOptions: { retries: 2, retryIntervalMs: 1_000 },
      shouldRetry: () => true,
    });

    await jest.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
