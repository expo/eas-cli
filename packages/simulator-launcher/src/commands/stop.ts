import { z } from 'zod';

import { stopAgentDeviceDaemonAsync } from '../utils/agentDevice';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { updateLauncherStateAsync, waitForLauncherStateAsync } from '../utils/state';

const SimulatorStatesSchema = z.object({
  devices: z.record(z.string(), z.array(z.object({ udid: z.string(), state: z.string() }))),
});

/** `simctl shutdown` fails for a device that is already shut down; that device is done. */
export async function shutdownSimulatorAsync(udid: string): Promise<void> {
  try {
    await commands.runAsync('xcrun', ['simctl', 'shutdown', udid]);
  } catch (error) {
    const { devices } = SimulatorStatesSchema.parse(
      JSON.parse(await commands.runAsync('xcrun', ['simctl', 'list', 'devices', '--json']))
    );
    if (
      Object.values(devices)
        .flat()
        .find(device => device.udid === udid)?.state !== 'Shutdown'
    ) {
      throw error;
    }
  }
}

export async function stopAsync(bootUuid: string): Promise<number> {
  const state = await updateLauncherStateAsync(bootUuid, current =>
    !current || current.status === 'disabled'
      ? { ...current, bootUuid, status: 'disabled' }
      : { ...current, status: 'stopping' }
  );
  if (state.status !== 'disabled') {
    await waitForLauncherStateAsync(bootUuid, current => current?.status === 'disabled', 140_000);
  }
  return 0;
}

export async function stopServicesAndShutdownSimulatorAsync(
  serviceProcesses: Set<ChildProcessHandle>,
  simulatorUdid?: string,
  agentDevicePrepareProcess?: ChildProcessHandle
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  for (const childProcessHandle of serviceProcesses) {
    await stopProcessAndDescendantsAsync(
      childProcessHandle,
      /* allowCompletedProcess */ childProcessHandle === agentDevicePrepareProcess
    )
      .then(() => serviceProcesses.delete(childProcessHandle))
      .catch(error => cleanupErrors.push(error));
  }
  if (simulatorUdid) {
    await stopAgentDeviceDaemonAsync().catch(error => cleanupErrors.push(error));
    await shutdownSimulatorAsync(simulatorUdid).catch(error => cleanupErrors.push(error));
  }
  try {
    commands.throwIfCommandCloseTimedOut();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      cleanupErrors,
      'Warm Simulator cleanup could not be confirmed; services or the device may still be running.'
    );
  }
}
