import {
  ClaimInputSchema,
  WarmSessionInfoSchema,
  updateLauncherStateAsync,
  waitForLauncherStateAsync,
} from '../utils/state';

export async function claimAsync(
  bootUuid: string,
  engine?: string,
  requestedDevice?: string
): Promise<number> {
  const input = ClaimInputSchema.safeParse({ engine, requestedDevice });
  if (!input.success) {
    throw new Error(
      `Invalid Simulator session request. Choose ${ClaimInputSchema.shape.engine.options.join(', ')} and an optional device name or UDID.`
    );
  }
  const acquired = await updateLauncherStateAsync(bootUuid, state => {
    if (state?.status !== 'ready') {
      throw new Error('No warm Simulator session is available to claim on this VM.');
    }
    WarmSessionInfoSchema.parse(state);
    return { ...state, ...input.data, status: 'claiming' };
  });
  const claimed = await waitForLauncherStateAsync(
    bootUuid,
    state => {
      if (!state || state.status === 'stopping' || state.status === 'disabled') {
        throw new Error('Simulator preparation was interrupted; cleanup may still be running.');
      }
      if (
        state.controllerPid !== acquired.controllerPid ||
        state.controllerStartTime !== acquired.controllerStartTime ||
        state.engine !== engine
      ) {
        throw new Error('The Simulator launcher returned a different session or engine.');
      }
      return state.status === 'claimed';
    },
    420_000
  );
  WarmSessionInfoSchema.parse(claimed);
  process.stdout.write(`${JSON.stringify(claimed)}\n`);
  return 0;
}
