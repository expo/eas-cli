import { type bunyan } from '@expo/logger';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  DeviceRunSessionStoppedError,
  waitForDeviceRunSessionStoppedAsync,
} from './remoteDeviceRunSession';
import { type StartupTasks } from './startupTasks';

export type DeviceRunSessionStartupWatch = {
  /** The startup abort reason when a Stop request arrives during startup. */
  readonly stopped: DeviceRunSessionStoppedError;
  /** Whether a Stop request aborted startup. */
  isStopped(): boolean;
  /** Ends the watch after the session reports ready. Throws if startup was aborted meanwhile. */
  completeAsync(): Promise<void>;
  /** Ends the watch without throwing, for cleanup. Safe to call more than once. */
  finishAsync(): Promise<void>;
};

/**
 * Polls for a Stop request while the session starts up, and aborts startup with `stopped` when
 * one arrives. A poll failure aborts startup with that error. Call `completeAsync` before the
 * lifetime wait, so only one poll runs at a time, and `finishAsync` in cleanup.
 */
export function watchDeviceRunSessionStartup({
  ctx,
  deviceRunSessionId,
  logger,
  startup,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  logger: bunyan;
  startup: Pick<StartupTasks, 'signal' | 'abort'>;
}): DeviceRunSessionStartupWatch {
  const stopped = new DeviceRunSessionStoppedError(
    `Device run session ${deviceRunSessionId} was stopped during startup.`
  );
  const done = new AbortController();
  const watchSignal = AbortSignal.any([startup.signal, done.signal]);
  const watching = waitForDeviceRunSessionStoppedAsync({
    ctx,
    deviceRunSessionId,
    logger,
    signal: watchSignal,
  }).then(
    () => {
      if (!watchSignal.aborted) {
        logger.info(stopped.message);
        startup.abort(stopped);
      }
    },
    error => startup.abort(error)
  );
  const finishAsync = async (): Promise<void> => {
    done.abort();
    await watching;
  };
  return {
    stopped,
    isStopped: () => startup.signal.reason === stopped,
    completeAsync: async () => {
      await finishAsync();
      startup.signal.throwIfAborted();
    },
    finishAsync,
  };
}
