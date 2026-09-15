import { withDeviceRunSessionTimeoutAsync } from '../deviceRunSessionTimeout';

afterEach(() => jest.useRealTimers());

it('aborts a stalled operation when its deadline expires', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  const operation = withDeviceRunSessionTimeoutAsync(
    { name: 'test operation', timeoutMs: 100 },
    async value => {
      signal = value;
      return await new Promise<void>(() => {});
    }
  );
  const rejected = expect(operation).rejects.toThrow('test operation timed out after 100ms');
  await jest.advanceTimersByTimeAsync(100);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not start an operation with an already aborted parent', async () => {
  const operation = jest.fn();
  await expect(
    withDeviceRunSessionTimeoutAsync(
      {
        name: 'test',
        timeoutMs: 100,
        signal: AbortSignal.abort(new Error('parent ended')),
      },
      operation
    )
  ).rejects.toThrow('parent ended');
  expect(operation).not.toHaveBeenCalled();
});

it('clears the deadline when an operation succeeds', async () => {
  jest.useFakeTimers();
  await expect(
    withDeviceRunSessionTimeoutAsync({ name: 'test', timeoutMs: 100 }, async () => 42)
  ).resolves.toBe(42);
  expect(jest.getTimerCount()).toBe(0);
});
