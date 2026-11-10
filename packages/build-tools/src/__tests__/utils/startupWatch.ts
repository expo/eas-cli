import { type watchDeviceRunSessionStartup } from '../../steps/utils/deviceRunSessionStartup';
import { DeviceRunSessionStoppedError } from '../../steps/utils/remoteDeviceRunSession';

/**
 * A `watchDeviceRunSessionStartup` stand-in that never polls. A test calls `stop` on the
 * returned watch (`jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value`) to act like
 * a Stop request during startup.
 */
export function createStartupWatchMock({
  startup,
}: Parameters<typeof watchDeviceRunSessionStartup>[0]): ReturnType<
  typeof watchDeviceRunSessionStartup
> & { stop: () => void } {
  const stopped = new DeviceRunSessionStoppedError('Stopped during startup.');
  return {
    stopped,
    stop: () => startup.abort(stopped),
    isStopped: () => startup.signal.reason === stopped,
    completeAsync: jest.fn(async () => startup.signal.throwIfAborted()),
    finishAsync: jest.fn(async () => {}),
  };
}
