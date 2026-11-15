import {
  ClaimInputSchema,
  type LauncherState,
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
  // Startup and handoff share the worker's existing claim timeout.
  const startedAt = Date.now();
  const deadline = startedAt + 420_000;
  let lastWaitLogAt: number | undefined;
  let controller: LauncherState | undefined;
  const ready = await waitForLauncherStateAsync(
    bootUuid,
    state => {
      if (state?.status === 'stopping' || state?.status === 'disabled' || state?.error) {
        throw new Error(
          `Simulator preparation was interrupted; cleanup may still be running.${state.error ? ` ${state.error}` : ''}`
        );
      }
      if (
        !state ||
        (state.status !== 'starting' && state.status !== 'ready') ||
        state.controllerPid === undefined
      ) {
        throw new Error('No warm Simulator session is available to claim on this VM.');
      }
      if (
        controller &&
        (state.controllerPid !== controller.controllerPid ||
          (controller.controllerStartTime !== undefined &&
            state.controllerStartTime !== controller.controllerStartTime))
      ) {
        throw new Error('The Simulator launcher returned a different session or engine.');
      }
      controller = state;
      if (state.status === 'starting') {
        const now = Date.now();
        if (lastWaitLogAt === undefined || now - lastWaitLogAt >= 30_000) {
          process.stderr.write(
            `Warm Simulator is still starting; waiting (${Math.floor((now - startedAt) / 1_000)}s elapsed, 420s limit).\n`
          );
          lastWaitLogAt = now;
        }
      }
      return state.status === 'ready';
    },
    deadline - Date.now()
  );
  const prepared = WarmSessionInfoSchema.parse(ready);
  const acquired = await updateLauncherStateAsync(bootUuid, state => {
    if (state?.status !== 'ready') {
      throw new Error('No warm Simulator session is available to claim on this VM.');
    }
    if (
      state.controllerPid !== prepared.controllerPid ||
      state.controllerStartTime !== prepared.controllerStartTime
    ) {
      throw new Error('The Simulator launcher returned a different session or engine.');
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for the Simulator launcher; cleanup may still be running.'
      );
    }
    WarmSessionInfoSchema.parse(state);
    return { ...state, ...input.data, status: 'claiming' };
  });
  if (lastWaitLogAt !== undefined) {
    process.stderr.write(
      `Warm Simulator became ready after waiting ${Math.floor((Date.now() - startedAt) / 1_000)}s.\n`
    );
  }
  const claimed = await waitForLauncherStateAsync(
    bootUuid,
    state => {
      if (!state || state.status === 'stopping' || state.status === 'disabled') {
        throw new Error(
          `Simulator preparation was interrupted; cleanup may still be running.${state?.error ? ` ${state.error}` : ''}`
        );
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
    Math.max(0, deadline - Date.now())
  );
  const { device } = WarmSessionInfoSchema.parse(claimed);
  if (
    requestedDevice &&
    device.name !== requestedDevice &&
    device.udid.toLowerCase() !== requestedDevice.toLowerCase()
  ) {
    throw new Error(`The Simulator launcher claimed ${device.name}, not ${requestedDevice}.`);
  }
  process.stdout.write(`${JSON.stringify(claimed)}\n`);
  return 0;
}

/** Continue the consumed claim after private serve-sim adoption, without acquiring another job. */
export async function prepareToolsAsync(bootUuid: string): Promise<number> {
  const acquired = await updateLauncherStateAsync(bootUuid, state => {
    if (state?.status !== 'claimed') {
      throw new Error('Claim and adopt the warm Simulator session before preparing its tools.');
    }
    WarmSessionInfoSchema.parse(state);
    return { ...state, prepareToolsRequested: true };
  });
  const ready = await waitForLauncherStateAsync(
    bootUuid,
    state => {
      if (
        !state ||
        state.status !== 'claimed' ||
        state.controllerPid !== acquired.controllerPid ||
        state.controllerStartTime !== acquired.controllerStartTime ||
        state.device?.udid !== acquired.device?.udid ||
        state.engine !== acquired.engine
      ) {
        throw new Error(
          'Warm Simulator tool preparation was interrupted; cleanup may still be running.'
        );
      }
      return state.toolsReady === true;
    },
    420_000
  );
  process.stdout.write(`${JSON.stringify(ready)}\n`);
  return 0;
}
