import { DeviceRunSession } from '@expo/eas-build-job';

import { startDeviceWebPreviewWithTunnelAsync } from '../../steps/utils/remoteDeviceRunSession';
import { type SessionTask } from '../runtime';

export const START_PREVIEW_TASK_ID = 'start_preview';

const PREVIEW_STARTUP_TIMEOUT_MS = 60_000;
// Appium sessions on Android share the emulator with expo-device-hub, which takes longer to attach.
const APPIUM_PREVIEW_STARTUP_TIMEOUT_MS = 120_000;

/** Starts serve-sim (macOS) or expo-device-hub (Linux) against the booted device and tunnels it. */
export function createStartPreviewTask({
  needs,
  after,
}: {
  needs: readonly string[];
  after: readonly string[];
}): SessionTask {
  return {
    id: START_PREVIEW_TASK_ID,
    displayName: 'Start web preview',
    needs,
    after,
    onFailure: 'fail-session',
    run: async ({ runtime, logger }) => {
      const { session } = runtime;
      const preview = await startDeviceWebPreviewWithTunnelAsync(runtime.ctx, {
        runtimePlatform: runtime.runtimePlatform,
        baseDomain: session.ngrokTunnelDomain,
        env: runtime.env,
        logger,
        timeoutMs:
          session.controller === DeviceRunSession.Controller.APPIUM
            ? APPIUM_PREVIEW_STARTUP_TIMEOUT_MS
            : PREVIEW_STARTUP_TIMEOUT_MS,
        // Only web-preview-only sessions pin the preview version; other controllers pin their own tool.
        packageVersion:
          session.controller === DeviceRunSession.Controller.WEB_PREVIEW_ONLY
            ? session.packageVersion
            : undefined,
        deviceRunSessionId: runtime.deviceRunSessionId,
        turnArgs: runtime.state.turnArgs,
        // No launch options: the launch_application task launches the app with simctl or adb,
        // so the preview can start while the application installs.
      });
      runtime.state.preview = preview;
      runtime.teardown.push('web preview', () => preview.stopAsync());
      logger.info(`Web preview URL: ${preview.previewPageUrl} (server: ${preview.apiUrl}).`);
    },
  };
}
