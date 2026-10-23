import { stopAgentDeviceDaemonAsync } from '../utils/agentDevice';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { updateLauncherStateAsync, waitForLauncherStateAsync } from '../utils/state';

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
    await commands
      .runAsync('xcrun', ['simctl', 'shutdown', simulatorUdid])
      .catch(error => cleanupErrors.push(error));
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
