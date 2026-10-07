import {
  DeviceRunSessionTimeoutError,
  withDeviceRunSessionTimeoutAsync,
} from '../deviceRunSessionTimeout';

afterEach(() => jest.useRealTimers());

it('rejects a stalled operation with a device run session timeout error', async () => {
  jest.useFakeTimers();
  const operation = withDeviceRunSessionTimeoutAsync(
    { name: 'test operation', timeoutMs: 100 },
    async () => await new Promise<void>(() => {})
  );
  const rejected = expect(operation).rejects.toThrow('test operation timed out after 100ms');
  const typed = expect(operation).rejects.toBeInstanceOf(DeviceRunSessionTimeoutError);
  await jest.advanceTimersByTimeAsync(100);
  await rejected;
  await typed;
});

it('passes other operation errors through unchanged', async () => {
  const error = new Error('operation failed');

  await expect(
    withDeviceRunSessionTimeoutAsync({ name: 'test', timeoutMs: 100 }, async () => {
      throw error;
    })
  ).rejects.toBe(error);
});
