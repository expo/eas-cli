import { bunyan } from '@expo/logger';

import { CustomBuildContext } from '../../../customBuildContext';
import { watchDeviceRunSessionStartup } from '../deviceRunSessionStartup';
import {
  DeviceRunSessionStoppedError,
  waitForDeviceRunSessionStoppedAsync,
} from '../remoteDeviceRunSession';
import { createStartupTasks } from '../startupTasks';

jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const ctx = {} as CustomBuildContext;
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as bunyan;

/** Makes the status poll settle only when the test says so, or end when its signal aborts. */
function holdStatusPoll(): { stop: () => void; fail: (error: Error) => void } {
  let stop!: () => void;
  let fail!: (error: Error) => void;
  jest.mocked(waitForDeviceRunSessionStoppedAsync).mockImplementation(
    ({ signal }) =>
      new Promise<void>((resolve, reject) => {
        stop = resolve;
        fail = reject;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      })
  );
  return { stop: () => stop(), fail: error => fail(error) };
}

function watch(startup = createStartupTasks(logger)) {
  return {
    startup,
    watch: watchDeviceRunSessionStartup({ ctx, deviceRunSessionId: 'drs-id', logger, startup }),
  };
}

describe(watchDeviceRunSessionStartup, () => {
  beforeEach(() => jest.clearAllMocks());

  it('aborts startup when the session is stopped', async () => {
    const poll = holdStatusPoll();
    const { startup, watch: startupWatch } = watch();
    poll.stop();
    await new Promise(resolve => setImmediate(resolve));
    expect(startupWatch.stopped).toBeInstanceOf(DeviceRunSessionStoppedError);
    expect(startup.signal.reason).toBe(startupWatch.stopped);
    expect(startupWatch.isStopped()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'Device run session drs-id was stopped during startup.'
    );
    await expect(startupWatch.completeAsync()).rejects.toBe(startupWatch.stopped);
  });

  it('ends the poll when startup completes, without aborting startup', async () => {
    holdStatusPoll();
    const { startup, watch: startupWatch } = watch();
    await expect(startupWatch.completeAsync()).resolves.toBeUndefined();
    const [{ signal }] = jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.calls[0];
    expect(signal?.aborted).toBe(true);
    expect(startup.signal.aborted).toBe(false);
    expect(startupWatch.isStopped()).toBe(false);
  });

  it('aborts startup with a status poll failure', async () => {
    const poll = holdStatusPoll();
    const { startup, watch: startupWatch } = watch();
    const failed = new Error('status poll failed');
    poll.fail(failed);
    await new Promise(resolve => setImmediate(resolve));
    expect(startup.signal.reason).toBe(failed);
    expect(startupWatch.isStopped()).toBe(false);
  });

  it('keeps the first abort reason when startup ends for another reason', async () => {
    holdStatusPoll();
    const { startup, watch: startupWatch } = watch();
    const failed = new Error('host startup failed');
    startup.abort(failed);
    await startupWatch.finishAsync();
    expect(startup.signal.reason).toBe(failed);
    expect(startupWatch.isStopped()).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('follows the step signal', async () => {
    holdStatusPoll();
    const step = new AbortController();
    const { startup, watch: startupWatch } = watch(createStartupTasks(logger, step.signal));
    step.abort(new Error('step cancelled'));
    await startupWatch.finishAsync();
    expect(startup.signal.aborted).toBe(true);
    expect(startupWatch.isStopped()).toBe(false);
  });
});
