import { EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import ora from 'ora';

import { apiClient } from '../api';
import log from '../log';
import { sleep } from '../utils/promise';
import { startAndroidBuildAsync } from './android/build';
import { CommandContext } from './context';
import { startIosBuildAsync } from './ios/build';
import { Build, BuildCommandPlatform, BuildStatus } from './types';
import { printBuildResults, printLogsUrls } from './utils/printBuildInfo';
import { ensureGitRepoExistsAsync, ensureGitStatusIsCleanAsync } from './utils/repository';

export async function buildAsync(commandCtx: CommandContext): Promise<void> {
  await ensureGitRepoExistsAsync();
  await ensureGitStatusIsCleanAsync();

  const scheduledBuilds = await startBuildsAsync(commandCtx);
  log.newLine();
  printLogsUrls(commandCtx.accountName, scheduledBuilds);
  log.newLine();

  if (commandCtx.waitForBuildEnd) {
    const builds = await waitForBuildEndAsync(
      commandCtx,
      scheduledBuilds.map(i => i.buildId)
    );
    printBuildResults(builds);
  }
}

async function startBuildsAsync(
  commandCtx: CommandContext
): Promise<
  { platform: BuildCommandPlatform.ANDROID | BuildCommandPlatform.IOS; buildId: string }[]
> {
  const shouldBuildAndroid = [BuildCommandPlatform.ANDROID, BuildCommandPlatform.ALL].includes(
    commandCtx.requestedPlatform
  );
  const shouldBuildiOS = [BuildCommandPlatform.IOS, BuildCommandPlatform.ALL].includes(
    commandCtx.requestedPlatform
  );
  const easConfig = await new EasJsonReader(
    commandCtx.projectDir,
    commandCtx.requestedPlatform
  ).readAsync(commandCtx.profile);

  const scheduledBuilds: {
    platform: BuildCommandPlatform.ANDROID | BuildCommandPlatform.IOS;
    buildId: string;
  }[] = [];
  if (shouldBuildAndroid) {
    const buildId = await startAndroidBuildAsync(commandCtx, easConfig);
    scheduledBuilds.push({ platform: BuildCommandPlatform.ANDROID, buildId });
  }
  if (shouldBuildiOS) {
    const buildId = await startIosBuildAsync(commandCtx, easConfig);
    scheduledBuilds.push({ platform: BuildCommandPlatform.IOS, buildId });
  }
  return scheduledBuilds;
}

async function waitForBuildEndAsync(
  commandCtx: CommandContext,
  buildIds: string[],
  { timeoutSec = 1800, intervalSec = 30 } = {}
): Promise<(Build | null)[]> {
  log('Waiting for build to complete. You can press Ctrl+C to exit.');
  const spinner = ora().start();
  let time = new Date().getTime();
  const endTime = time + timeoutSec * 1000;
  while (time <= endTime) {
    const builds: (Build | null)[] = await Promise.all(
      buildIds.map(async buildId => {
        try {
          const { data } = await apiClient
            .get(`projects/${commandCtx.projectId}/builds/${buildId}`)
            .json();
          return data;
        } catch (err) {
          return null;
        }
      })
    );
    if (builds.length === 1) {
      switch (builds[0]?.status) {
        case BuildStatus.FINISHED:
          spinner.succeed('Build finished');
          return builds;
        case BuildStatus.IN_QUEUE:
          spinner.text = 'Build queued...';
          break;
        case BuildStatus.IN_PROGRESS:
          spinner.text = 'Build in progress...';
          break;
        case BuildStatus.ERRORED:
          spinner.fail('Build failed');
          throw new Error(`Standalone build failed!`);
        default:
          spinner.warn('Unknown status.');
          throw new Error(`Unknown status: ${builds} - aborting!`);
      }
    } else {
      if (builds.filter(build => build?.status === BuildStatus.FINISHED).length === builds.length) {
        spinner.succeed('All builds have finished');
        return builds;
      } else if (
        builds.filter(build =>
          build?.status ? [BuildStatus.FINISHED, BuildStatus.ERRORED].includes(build.status) : false
        ).length === builds.length
      ) {
        spinner.fail('Some of the builds failed');
        return builds;
      } else {
        const inQueue = builds.filter(build => build?.status === BuildStatus.IN_QUEUE).length;
        const inProgress = builds.filter(build => build?.status === BuildStatus.IN_PROGRESS).length;
        const errored = builds.filter(build => build?.status === BuildStatus.ERRORED).length;
        const finished = builds.filter(build => build?.status === BuildStatus.FINISHED).length;
        const unknownState = builds.length - inQueue - inProgress - errored - finished;
        spinner.text = [
          inQueue && `Builds in queue: ${inQueue}`,
          inProgress && `Builds in progress: ${inProgress}`,
          errored && chalk.red(`Builds failed: ${errored}`),
          finished && chalk.green(`Builds finished: ${finished}`),
          unknownState && chalk.red(`Builds in unknown state: ${unknownState}`),
        ]
          .filter(i => i)
          .join('\t');
      }
    }
    time = new Date().getTime();
    await sleep(intervalSec * 1000);
  }
  spinner.warn('Timed out');
  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}
