import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { downloadBuildAsync } from '../../steps/functions/downloadBuild';
import { installBuildAsync } from '../../steps/functions/installBuild';
import { launchApplicationAsync } from '../../steps/functions/launchApplication';
import { type SessionTask } from '../runtime';

export const DOWNLOAD_BUILD_TASK_ID = 'download_build';
export const INSTALL_BUILD_TASK_ID = 'install_build';
export const LAUNCH_APPLICATION_TASK_ID = 'launch_application';

/** Downloads and extracts the application while the device boots. */
export function createDownloadBuildTask(): SessionTask {
  return {
    id: DOWNLOAD_BUILD_TASK_ID,
    displayName: 'Download application',
    onFailure: 'degrade-application',
    run: async ({ runtime, logger }) => {
      const application = nullthrows(runtime.job.application, 'The job requests no application.');
      const source =
        'buildId' in application.source
          ? { buildId: application.source.buildId }
          : { applicationArchiveUrl: application.source.archiveUrl };
      logger.info(
        'buildId' in source
          ? `Downloading build ${source.buildId}...`
          : 'Downloading application archive...'
      );
      const { artifactPath } = await downloadBuildAsync({
        logger,
        ...source,
        graphqlClient: runtime.ctx.graphqlClient,
        robotAccessToken: runtime.job.secrets.robotAccessToken,
        extensions: runtime.device.platform === Platform.IOS ? ['app'] : ['apk'],
      });
      runtime.state.download = { artifactPath };
    },
  };
}

/** Installs the downloaded application on the booted device. */
export function createInstallBuildTask({ needs }: { needs: readonly string[] }): SessionTask {
  return {
    id: INSTALL_BUILD_TASK_ID,
    displayName: 'Install application',
    needs,
    onFailure: 'degrade-application',
    run: async ({ runtime, logger }) => {
      const { artifactPath } = nullthrows(
        runtime.state.download,
        'The application was not downloaded.'
      );
      runtime.state.install = await installBuildAsync({
        artifactPath,
        runtimePlatform: runtime.runtimePlatform,
        env: runtime.env,
        logger,
      });
    },
  };
}

/** Launches the installed application with the requested arguments and URL. */
export function createLaunchApplicationTask({ needs }: { needs: readonly string[] }): SessionTask {
  return {
    id: LAUNCH_APPLICATION_TASK_ID,
    displayName: 'Launch application',
    needs,
    onFailure: 'degrade-application',
    run: async ({ runtime, logger }) => {
      const application = nullthrows(runtime.job.application, 'The job requests no application.');
      const { applicationIdentifier, activityName } = nullthrows(
        runtime.state.install,
        'The application was not installed.'
      );
      await launchApplicationAsync({
        applicationIdentifier,
        activityName,
        launchArgs: application.launchArgs,
        openUrl: application.openUrl,
        runtimePlatform: runtime.runtimePlatform,
        env: runtime.env,
        logger,
      });
    },
  };
}
