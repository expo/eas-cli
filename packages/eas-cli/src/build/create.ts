import { EasJsonReader } from '@expo/eas-json';

import log from '../log';
import { prepareAndroidBuildAsync } from './android/build';
import { CommandContext } from './context';
import { prepareIosBuildAsync } from './ios/build';
import { Platform, RequestedPlatform } from './types';
import { waitForBuildEndAsync } from './utils/pollingLogger';
import { printLogsUrls } from './utils/printBuildInfo';
import { ensureGitRepoExistsAsync, ensureGitStatusIsCleanAsync } from './utils/repository';

export async function buildAsync(commandCtx: CommandContext): Promise<void> {
  await ensureGitRepoExistsAsync();
  await ensureGitStatusIsCleanAsync(commandCtx.nonInteractive);

  const scheduledBuilds = await startBuildsAsync(commandCtx);

  log.newLine();
  printLogsUrls(commandCtx.accountName, scheduledBuilds);
  log.newLine();

  if (commandCtx.waitForBuildEnd) {
    await waitForBuildEndAsync(commandCtx, {
      buildIds: scheduledBuilds.map(i => i.buildId),
    });
  }
}

async function startBuildsAsync(
  commandCtx: CommandContext
): Promise<{ platform: Platform; buildId: string }[]> {
  const shouldBuildAndroid = [RequestedPlatform.Android, RequestedPlatform.All].includes(
    commandCtx.requestedPlatform
  );
  const shouldBuildiOS = [RequestedPlatform.iOS, RequestedPlatform.All].includes(
    commandCtx.requestedPlatform
  );
  const easConfig = await new EasJsonReader(
    commandCtx.projectDir,
    commandCtx.requestedPlatform
  ).readAsync(commandCtx.profile);

  const builds: {
    platform: Platform;
    sendBuildRequestAsync: () => Promise<string>;
  }[] = [];
  if (shouldBuildAndroid) {
    const sendBuildRequestAsync = await prepareAndroidBuildAsync(commandCtx, easConfig);
    builds.push({ platform: Platform.Android, sendBuildRequestAsync });
  }
  if (shouldBuildiOS) {
    const sendBuildRequestAsync = await prepareIosBuildAsync(commandCtx, easConfig);
    builds.push({ platform: Platform.iOS, sendBuildRequestAsync });
  }

  return Promise.all(
    builds.map(async ({ platform, sendBuildRequestAsync }) => ({
      platform,
      buildId: await sendBuildRequestAsync(),
    }))
  );
}
