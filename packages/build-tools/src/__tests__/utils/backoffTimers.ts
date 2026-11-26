export function useFakeBackoffTimers(): void {
  // Streams and fs callbacks need the real nextTick and setImmediate; only the backoff timers are faked.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
}

const MAX_IO_TURNS_BEFORE_BACKOFF = 1000;

export async function waitForBackoffTimerAsync(): Promise<void> {
  for (let turns = 0; jest.getTimerCount() === 0; turns++) {
    if (turns === MAX_IO_TURNS_BEFORE_BACKOFF) {
      throw new Error('No backoff timer was scheduled.');
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

export async function fireBackoffTimersAsync(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await waitForBackoffTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
  }
}
