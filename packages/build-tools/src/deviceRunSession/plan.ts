import { DeviceRunSession, Platform } from '@expo/eas-build-job';

import { type SessionTask } from './runtime';
import {
  DOWNLOAD_BUILD_TASK_ID,
  INSTALL_BUILD_TASK_ID,
  LAUNCH_APPLICATION_TASK_ID,
  createDownloadBuildTask,
  createInstallBuildTask,
  createLaunchApplicationTask,
} from './tasks/application';
import { START_CONTROLLER_TASK_ID, createStartControllerTask } from './tasks/controller';
import { BOOT_DEVICE_TASK_ID, createBootDeviceTask } from './tasks/device';
import { START_LOCAL_EGRESS_TASK_ID, createStartLocalEgressTask } from './tasks/egress';
import { createHoldSessionTask } from './tasks/hold';
import {
  FETCH_TURN_CREDENTIALS_TASK_ID,
  SELECT_XCODE_TASK_ID,
  createFetchTurnCredentialsTask,
  createSelectXcodeTask,
} from './tasks/network';
import { createStartPollersTask } from './tasks/pollers';
import { START_PREVIEW_TASK_ID, createStartPreviewTask } from './tasks/preview';
import { PUBLISH_REMOTE_CONFIG_TASK_ID, createPublishRemoteConfigTask } from './tasks/publish';
import { PREFETCH_TOOLING_TASK_ID, createPrefetchToolingTask } from './tasks/tooling';

/**
 * Turns a session job into the task graph the runner executes.
 *
 * The graph encodes the session's real dependencies instead of a step order.
 * Everything that needs no device (downloading the application, caching tool
 * packages, fetching TURN credentials, starting pollers) runs while the device
 * boots. The preview and the controller start as soon as the device is ready,
 * concurrently with the application install. The remote session is published
 * once the preview and controller are up and the application launch has finished.
 */
export function planDeviceRunSession(job: DeviceRunSession.Job): SessionTask[] {
  const isIos = job.device.platform === Platform.IOS;
  const hasApplication = job.application !== undefined;
  const { controller } = job.session;
  const hasController = controller !== DeviceRunSession.Controller.WEB_PREVIEW_ONLY;

  const tasks: SessionTask[] = [];

  // Anything that must be in place before the device boots.
  const bootNeeds: string[] = [];
  if (isIos) {
    // The selected Xcode decides which Simulator runtime boots and which tools
    // the preview and controller use, so select it once, before everything else.
    tasks.push(createSelectXcodeTask());
    bootNeeds.push(SELECT_XCODE_TASK_ID);
  }
  if (job.egress === DeviceRunSession.Egress.LOCAL) {
    // The Simulator reads the system proxy at boot.
    tasks.push(createStartLocalEgressTask());
    bootNeeds.push(START_LOCAL_EGRESS_TASK_ID);
  }
  tasks.push(createBootDeviceTask({ needs: bootNeeds }));

  // Device-independent work that overlaps the boot.
  tasks.push(createPrefetchToolingTask());
  tasks.push(createFetchTurnCredentialsTask());
  if (isIos) {
    tasks.push(createStartPollersTask({ needs: [SELECT_XCODE_TASK_ID] }));
  }
  if (hasApplication) {
    tasks.push(createDownloadBuildTask());
  }

  // Work that needs the booted device.
  tasks.push(
    createStartPreviewTask({
      needs: [BOOT_DEVICE_TASK_ID],
      after: [PREFETCH_TOOLING_TASK_ID, FETCH_TURN_CREDENTIALS_TASK_ID],
    })
  );
  if (hasController) {
    tasks.push(
      createStartControllerTask({
        controller,
        // The agent-device daemon attaches to the device lazily; Argent and Appium
        // resolve the booted device when they start.
        needs: [
          ...(isIos ? [SELECT_XCODE_TASK_ID] : []),
          ...(controller === DeviceRunSession.Controller.AGENT_DEVICE ? [] : [BOOT_DEVICE_TASK_ID]),
        ],
        after: [PREFETCH_TOOLING_TASK_ID],
      })
    );
  }
  if (hasApplication) {
    tasks.push(createInstallBuildTask({ needs: [BOOT_DEVICE_TASK_ID, DOWNLOAD_BUILD_TASK_ID] }));
    tasks.push(createLaunchApplicationTask({ needs: [INSTALL_BUILD_TASK_ID] }));
  }

  // Hand-off and the session itself.
  tasks.push(
    createPublishRemoteConfigTask({
      needs: [START_PREVIEW_TASK_ID, ...(hasController ? [START_CONTROLLER_TASK_ID] : [])],
      // A failed application install or launch does not block the hand-off; the
      // device stays usable and the failure is visible in the job log.
      after: hasApplication ? [LAUNCH_APPLICATION_TASK_ID] : [],
    })
  );
  tasks.push(createHoldSessionTask({ needs: [PUBLISH_REMOTE_CONFIG_TASK_ID] }));

  return tasks;
}
