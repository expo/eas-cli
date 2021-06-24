import { EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import ora from 'ora';

import { BuildFragment, BuildStatus } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log from '../log';
import { sleep } from '../utils/promise';
import vcs from '../vcs';
import { prepareAndroidBuildAsync } from './android/build';
import { CommandContext } from './context';
import { prepareIosBuildAsync } from './ios/build';
import { Platform, RequestedPlatform } from './types';
import { printBuildResults, printLogsUrls } from './utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from './utils/repository';

export async function buildAsync(commandCtx: CommandContext): Promise<void> {
  await vcs.ensureRepoExistsAsync();
  await ensureRepoIsCleanAsync(commandCtx.nonInteractive);

  const scheduledBuilds = await startBuildsAsync(commandCtx);
  if (commandCtx.local) {
    return;
  }
  Log.newLine();
  printLogsUrls(commandCtx.accountName, scheduledBuilds);
  Log.newLine();

  if (commandCtx.waitForBuildEnd) {
    const builds = await waitForBuildEndAsync(scheduledBuilds.map(i => i.buildId));
    printBuildResults(commandCtx.accountName, builds);
    exitWithNonZeroCodeIfSomeBuildsFailed(builds);
  }
}

async function startBuildsAsync(
  commandCtx: CommandContext
): Promise<{ platform: Platform; buildId: string }[]> {
  const shouldBuildAndroid = [RequestedPlatform.Android, RequestedPlatform.All].includes(
    commandCtx.requestedPlatform
  );
  const shouldBuildIos = [RequestedPlatform.Ios, RequestedPlatform.All].includes(
    commandCtx.requestedPlatform
  );
  const easConfig = await new EasJsonReader(
    commandCtx.projectDir,
    commandCtx.requestedPlatform
  ).readAsync(commandCtx.profile);

  const builds: {
    platform: Platform;
    sendBuildRequestAsync: () => Promise<string | undefined>;
  }[] = [];
  if (shouldBuildAndroid) {
    const sendBuildRequestAsync = await prepareAndroidBuildAsync(commandCtx, easConfig);
    builds.push({ platform: Platform.ANDROID, sendBuildRequestAsync });
  }
  if (shouldBuildIos) {
    const sendBuildRequestAsync = await prepareIosBuildAsync(commandCtx, easConfig);
    builds.push({ platform: Platform.IOS, sendBuildRequestAsync });
  }
  return (
    await Promise.all(
      builds.map(async ({ platform, sendBuildRequestAsync }) => ({
        platform,
        buildId: await sendBuildRequestAsync(),
      }))
    )
  ).filter((build): build is { platform: Platform; buildId: string } => !!build.buildId);
}

async function waitForBuildEndAsync(
  buildIds: string[],
  { timeoutSec = 3600, intervalSec = 30 } = {}
): Promise<(BuildFragment | null)[]> {
  Log.log('Waiting for build to complete. You can press Ctrl+C to exit.');
  const spinner = ora().start();
  let time = new Date().getTime();
  const endTime = time + timeoutSec * 1000;
  while (time <= endTime) {
    const builds: (BuildFragment | null)[] = await Promise.all(
      buildIds.map(async buildId => {
        try {
          return await BuildQuery.byIdAsync(buildId, { useCache: false });
        } catch (err) {
          return null;
        }
      })
    );
    if (builds.length === 1) {
      const build = nullthrows(builds[0]);
      switch (build.status) {
        case BuildStatus.Finished:
          spinner.succeed('Build finished');
          return builds;
        case BuildStatus.New:
          spinner.text = 'Build created';
          break;
        case BuildStatus.InQueue:
          spinner.text = 'Build queued...';
          break;
        case BuildStatus.Canceled:
          spinner.text = 'Build canceled';
          spinner.stopAndPersist();
          return builds;
        case BuildStatus.InProgress:
          spinner.text = 'Build in progress...';
          break;
        case BuildStatus.Errored:
          spinner.fail('Build failed');
          if (build.error) {
            return builds;
          } else {
            throw new Error(`Standalone build failed!`);
          }
        default:
          spinner.warn('Unknown status.');
          throw new Error(`Unknown status: ${builds} - aborting!`);
      }
    } else {
      if (builds.filter(build => build?.status === BuildStatus.Finished).length === builds.length) {
        spinner.succeed('All builds have finished');
        return builds;
      } else if (
        builds.filter(build =>
          build?.status
            ? [BuildStatus.Finished, BuildStatus.Errored, BuildStatus.Canceled].includes(
                build.status
              )
            : false
        ).length === builds.length
      ) {
        spinner.fail('Some of the builds were canceled or failed.');
        return builds;
      } else {
        const newBuilds = builds.filter(build => build?.status === BuildStatus.New).length;
        const inQueue = builds.filter(build => build?.status === BuildStatus.InQueue).length;
        const inProgress = builds.filter(build => build?.status === BuildStatus.InProgress).length;
        const errored = builds.filter(build => build?.status === BuildStatus.Errored).length;
        const finished = builds.filter(build => build?.status === BuildStatus.Finished).length;
        const canceled = builds.filter(build => build?.status === BuildStatus.Canceled).length;
        const unknownState = builds.length - inQueue - inProgress - errored - finished;
        spinner.text = [
          newBuilds && `Builds created: ${newBuilds}`,
          inQueue && `Builds in queue: ${inQueue}`,
          inProgress && `Builds in progress: ${inProgress}`,
          canceled && `Builds canceled: ${canceled}`,
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

function exitWithNonZeroCodeIfSomeBuildsFailed(maybeBuilds: (BuildFragment | null)[]): void {
  const failedBuilds = (maybeBuilds.filter(i => i) as BuildFragment[]).filter(
    i => i.status === BuildStatus.Errored
  );
  if (failedBuilds.length > 0) {
    process.exit(1);
  }
}
