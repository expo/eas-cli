import { sleepAsync } from '../promise';

describe(sleepAsync, () => {
  it('clears its timer when aborted', async () => {
    jest.useFakeTimers();
    const abortController = new AbortController();
    const sleepPromise = sleepAsync(5_000, abortController.signal);

    expect(jest.getTimerCount()).toBe(1);
    abortController.abort();
    await sleepPromise;

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
