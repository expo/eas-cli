import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import os from 'node:os';

import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { waitForWarmSimulatorCleanupAsync } from '../../utils/warmSimulatorCleanup';
import { SERVE_SIM_STOP_GRACE_PERIOD_MS } from './IosSimulatorRecordingUtils';
import { findAvailablePortAsync, spawnDetached } from './remoteDeviceRunSession';
import { waitForServeSimControlAsync } from './serveSimControl';
import { runServeSimActionWithResultAsync } from './serveSimActions';
import { SERVE_SIM_STATE_DIR } from './serveSimMetricsRecorder';
import {
  configureSimulatorProxyEnvironmentAsync,
  readLocalEgressHandoffAsync,
} from './localEgress';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';

type SimulatorStartup = {
  udid: IosSimulatorUuid;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
};

/** A running uninstrumented device cannot be enrolled; serve-sim owns the next boot. */
export async function prepareResidentIosSimulatorAsync({
  udid,
  env,
  logger,
  signal,
}: SimulatorStartup): Promise<void> {
  await waitForWarmSimulatorCleanupAsync(env, { signal });
  signal?.throwIfAborted();
  const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
  signal?.throwIfAborted();
  if (device && device.state !== 'Shutdown') {
    logger.info(`Shutting down ${udid} for resident egress startup.`);
    try {
      await spawn('xcrun', ['simctl', 'shutdown', udid], { env, logger, signal });
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
  }
  signal?.throwIfAborted();
}

/** Boot-only workflows release the temporary server after strict native admission. */
export async function bootResidentIosSimulatorAsync(options: SimulatorStartup): Promise<void> {
  const { udid, env, logger, signal } = options;
  const localEgress = await readLocalEgressHandoffAsync();
  await prepareResidentIosSimulatorAsync(options);
  const port = await findAvailablePortAsync();
  signal?.throwIfAborted();
  const execution = resolvePackageExec(resolveConfiguredPackageManager(env, PackageManager.NPM), [
    `@expo/serve-sim@${env.SERVE_SIM_VERSION || 'latest'}`,
    udid,
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    '--require-token',
    '--disable-share',
    '--quiet',
    localEgress ? '--enable' : '--disable',
    'egressGuard',
  ]);
  const stateDir = env.SERVE_SIM_STATE_DIR ?? SERVE_SIM_STATE_DIR;
  const server = spawnDetached({
    ...execution,
    env: { ...env, TMPDIR: env.TMPDIR ?? os.tmpdir(), SERVE_SIM_STATE_DIR: stateDir },
    logger,
    stopGracePeriodMs: SERVE_SIM_STOP_GRACE_PERIOD_MS,
  });
  const errors: unknown[] = [];
  try {
    const token = await waitForServeSimControlAsync({
      device: udid,
      port,
      stateDir,
      previewServer: server,
      timeoutMs: 30 * 60_000,
      signal,
    });
    signal?.throwIfAborted();
    await withDeviceRunSessionTimeoutAsync(
      { name: 'Simulator setup', timeoutMs: 30 * 60_000, signal },
      async () => {
        await configureSimulatorProxyEnvironmentAsync({ udid, env, logger });
        signal?.throwIfAborted();
        try {
          await IosSimulatorUtils.disableApsdAsync({ udid, env });
        } catch (err) {
          signal?.throwIfAborted();
          logger.warn({ err }, 'Failed to disable apsd in the Simulator.');
        }
        signal?.throwIfAborted();
        await IosSimulatorUtils.waitForReadyAsync({ udid, env });
        signal?.throwIfAborted();
      }
    );
    const status = JSON.parse(
      await runServeSimActionWithResultAsync({
        port,
        token,
        action: 'egress.status',
        params: { udid },
        timeoutMs: 10_000,
        signal,
      })
    );
    if (status?.available !== true || status.enabled !== !!localEgress) {
      throw new Error('Serve-sim did not confirm the requested resident egress policy.');
    }
  } catch (error) {
    errors.push(error);
  }
  // Session release retains the resident image, startup record and page for this boot.
  try {
    await server.stopAsync();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Resident boot and server cleanup failed.');
  }
}
