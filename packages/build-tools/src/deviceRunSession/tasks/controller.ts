import { DeviceRunSession, SystemError } from '@expo/eas-build-job';

import { startAgentDeviceControllerAsync } from '../../steps/functions/startAgentDeviceRemoteSession';
import { startAppiumControllerAsync } from '../../steps/functions/startAppiumRemoteSession';
import { startArgentControllerAsync } from '../../steps/functions/startArgentRemoteSession';
import { getNgrokAuthtokenOrThrow } from '../../steps/utils/remoteDeviceRunSession';
import { type ControllerHandle, type SessionTask } from '../runtime';

export const START_CONTROLLER_TASK_ID = 'start_controller';

const controllerDisplayNames: Record<DeviceRunSession.Controller, string> = {
  [DeviceRunSession.Controller.WEB_PREVIEW_ONLY]: 'Start web preview controller',
  [DeviceRunSession.Controller.AGENT_DEVICE]: 'Start agent-device',
  [DeviceRunSession.Controller.ARGENT]: 'Start Argent',
  [DeviceRunSession.Controller.APPIUM]: 'Start Appium',
};

/** Starts the tool that lets clients drive the device, and tunnels it. Not used for web-preview-only sessions. */
export function createStartControllerTask({
  controller,
  needs,
  after,
}: {
  controller: DeviceRunSession.Controller;
  needs: readonly string[];
  after: readonly string[];
}): SessionTask {
  return {
    id: START_CONTROLLER_TASK_ID,
    displayName: controllerDisplayNames[controller],
    needs,
    after,
    onFailure: 'fail-session',
    run: async ({ runtime, logger, signal }) => {
      const { session, env, runtimePlatform } = runtime;
      const options = {
        deviceRunSessionId: runtime.deviceRunSessionId,
        packageVersion: session.packageVersion,
        ngrokTunnelDomain: session.ngrokTunnelDomain,
        ngrokAuthtoken: getNgrokAuthtokenOrThrow(env),
        env,
        logger,
      };

      let handle: ControllerHandle;
      switch (controller) {
        case DeviceRunSession.Controller.AGENT_DEVICE:
          handle = await startAgentDeviceControllerAsync(runtime.ctx, options);
          break;
        case DeviceRunSession.Controller.ARGENT:
          handle = await startArgentControllerAsync(runtime.ctx, {
            ...options,
            runtimePlatform,
            signal,
          });
          break;
        case DeviceRunSession.Controller.APPIUM:
          handle = await startAppiumControllerAsync(runtime.ctx, {
            ...options,
            runtimePlatform,
            installation: runtime.state.appiumInstallation,
          });
          break;
        case DeviceRunSession.Controller.WEB_PREVIEW_ONLY:
          throw new SystemError('Web-preview-only sessions have no controller to start.');
      }

      runtime.state.controller = handle;
      runtime.teardown.push(controllerDisplayNames[controller], () => handle.stopAsync());
    },
  };
}
