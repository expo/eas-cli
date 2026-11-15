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
