import { EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
// @ts-ignore
import Spinnies from 'spinnies';

import log from '../log';
import { sleep } from '../utils/promise';
import { formatMilliseconds } from '../utils/timer';
import { prepareAndroidBuildAsync } from './android/build';
import mocks from './build-requests';
import { platformDisplayNames } from './constants';
import { CommandContext } from './context';
import { prepareIosBuildAsync } from './ios/build';
import { Build, BuildStatus, Platform, RequestedPlatform } from './types';
import { printLogsUrls } from './utils/printBuildInfo';
import { ensureGitRepoExistsAsync, ensureGitStatusIsCleanAsync } from './utils/repository';

const testLogging = false;

export async function buildAsync(commandCtx: CommandContext): Promise<void> {
  await ensureGitRepoExistsAsync();
  await ensureGitStatusIsCleanAsync(commandCtx.nonInteractive);

  if (testLogging) {
    await waitForBuildEndAsync(commandCtx, Object.keys(mockBuilds));
    process.exit(0);
  }

  const scheduledBuilds = await startBuildsAsync(commandCtx);
  // const scheduledBuilds = Object.values(mockBuilds);

  log.newLine();
  printLogsUrls(commandCtx.accountName, scheduledBuilds);
  log.newLine();

  if (commandCtx.waitForBuildEnd) {
    await waitForBuildEndAsync(
      commandCtx,
      // Object.keys(mockBuilds)
      scheduledBuilds.map(i => i.buildId)
    );
    // log.newLine();
    // printBuildResults(commandCtx.accountName, builds);
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

const mockBuilds: Record<string, any> = {
  '5ef5e676-b127-4b9e-bf7b-37827721e039': {
    id: '5ef5e676-b127-4b9e-bf7b-37827721e039',
    buildId: '5ef5e676-b127-4b9e-bf7b-37827721e039',
    platform: 'android',
    status: BuildStatus.IN_PROGRESS,
    artifacts: {
      buildUrl:
        'https://somn-really-long.io/accounts/expo-turtle/builds/aff486c1-cb2f-49c4-86dd-649d0f68578a',
    },
  },
  'aff486c1-cb2f-49c4-86dd-649d0f68578a': {
    id: 'aff486c1-cb2f-49c4-86dd-649d0f68578a',
    buildId: 'aff486c1-cb2f-49c4-86dd-649d0f68578a',
    platform: 'ios',
    status: BuildStatus.FINISHED,
  },
};

let i = 0;
function getMockBuilds(): (Build | string)[] {
  const mock = mocks[i] as any;
  i++;
  return mock;
}

function pad(str: string, width: number): string {
  const len = Math.max(0, width - str.length);
  return str + Array(len + 1).join(' ');
}

function longestStringLength(values: string[]): number {
  return values.reduce((max, option) => Math.max(max, option.length), 0);
}

async function waitForBuildEndAsync(
  commandCtx: CommandContext,
  buildIds: string[],
  { timeoutSec = 1800, intervalSec = 30 } = {}
): Promise<(Build | null)[]> {
  log(
    `\u203A Waiting for build${
      buildIds.length !== 1 ? 's' : ''
    } to complete. ${chalk.dim`You can exit with Ctrl+C`}`
  );
  let time = new Date().getTime();
  const endTime = time + timeoutSec * 1000;

  const spinnies = new Spinnies();
  const unknownName = 'Pending';

  while (time <= endTime) {
    // const builds = getMockBuilds();
    const builds: (Build | string)[] = await Promise.all(
      buildIds.map(async buildId => {
        try {
          const { data } = await apiClient
            .get(`projects/${commandCtx.projectId}/builds/${buildId}`)
            .json();
          return data;
        } catch (err) {
          return buildId;
        }
      })
    );

    const padWidth = longestStringLength(
      builds.map(build => {
        if (typeof build === 'string') return unknownName;
        return build.platform;
      })
    );

    // Remove any spinners which weren't returned on subsequent requests.
    const latestBuildIds = builds.map(build => {
      if (typeof build === 'string') return build;
      return build.id;
    });

    for (const id of Object.keys(spinnies.spinners)) {
      if (!latestBuildIds.includes(id)) {
        spinnies.remove(id);
      }
    }

    for (const build of builds) {
      let id = '';
      if (typeof build === 'string') {
        id = build;
      } else {
        id = build.id;
      }

      if (!id) continue;

      // Ensure spinner
      if (!spinnies.pick(id)) {
        spinnies.add(id, { text: '' });
      }

      const tableFormat = (name: string, msg: string) =>
        `${chalk.bold(pad(name, padWidth))} ${msg}`;

      if (typeof build === 'string') {
        spinnies.update(id, {
          text: chalk.dim(tableFormat(unknownName, id)),
          spinnerColor: 'gray',
        });
      } else {
        // Prevent printing a finished state more than once.
        // Without this, if the last item finished first,
        // then when all items finish, the last item will be printed twice.
        if (stateCache[id] === build.status) {
          continue;
        }
        stateCache[id] = build.status;

        const prefixed = (msg: string) => {
          return tableFormat(platformDisplayNames[build.platform] ?? build.platform, msg);
        };
        switch (build.status) {
          case BuildStatus.IN_QUEUE:
            spinnies.update(id, {
              text: prefixed('Waiting in queue...'),
              spinnerColor: 'white',
            });
            break;
          case BuildStatus.IN_PROGRESS:
            spinnies.update(id, {
              text: chalk.cyan(prefixed('Building...')),
              spinnerColor: 'cyan',
            });
            break;
          case BuildStatus.ERRORED:
            {
              const duration = formatMilliseconds(getBuildDuration(build));
              const durationLabel = duration ? ` in ${duration}` : '';
              spinnies.fail(id, { text: prefixed(`(Failed${durationLabel})`) });
            }
            break;
          case BuildStatus.FINISHED:
            {
              const duration = formatMilliseconds(getBuildDuration(build));
              const durationLabel = duration ? ` in ${duration}` : '';
              const url = build.artifacts?.buildUrl;
              spinnies.succeed(id, {
                text: prefixed(`(Succeeded${durationLabel})\n${url}\n`),
              });
            }
            break;
        }
      }
    }

    const expectedBuilds = builds.filter(build => typeof build !== 'string') as Build[];

    const complete =
      expectedBuilds.filter(build => {
        return [BuildStatus.FINISHED, BuildStatus.ERRORED].includes(build.status);
      }).length === builds.length;

    if (complete) {
      clearInterval(spinnies.currentInterval);
      return expectedBuilds;
    }

    time = new Date().getTime();
    if (testLogging) {
      await sleep(intervalSec * 10);
    } else {
      await sleep(intervalSec * 1000);
    }
  }

  spinnies.stopAll('stopped');

  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}

function getBuildDuration(build: Build): number {
  if (build.metrics) {
    return build.metrics.buildEndTimestamp - build.metrics.buildStartTimestamp;
  }
  return 0;
}

const stateCache: Record<string, BuildStatus> = {};
