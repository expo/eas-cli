import chalk from 'chalk';
// @ts-ignore
import Spinnies from 'spinnies';

import { apiClient } from '../../api';
import log from '../../log';
import { sleep } from '../../utils/promise';
import { formatMilliseconds } from '../../utils/timer';
import { platformDisplayNames } from '../constants';
import { CommandContext } from '../context';
import { Build, BuildStatus } from '../types';

function pad(str: string, width: number): string {
  const len = Math.max(0, width - str.length);
  return str + Array(len + 1).join(' ');
}

function longestStringLength(values: string[]): number {
  return values.reduce((max, option) => Math.max(max, option.length), 0);
}

function logWaiting(buildCount: number) {
  log(
    `\u203A Waiting for build${
      buildCount !== 1 ? 's' : ''
    } to complete. ${chalk.dim`You can exit with Ctrl+C`}`
  );
}

export async function pollBuildsAsync(
  { projectId }: Pick<CommandContext, 'projectId'>,
  buildIds: string[]
) {
  // const builds = getMockBuilds();
  const builds: (Build | string)[] = await Promise.all(
    buildIds.map(async buildId => {
      try {
        const { data } = await apiClient.get(`projects/${projectId}/builds/${buildId}`).json();
        return data;
      } catch (err) {
        return buildId;
      }
    })
  );
  return builds;
}

export async function waitForBuildEndAsync(
  commandCtx: Pick<CommandContext, 'projectId'>,
  {
    buildIds,
    requestBuildsAsync = pollBuildsAsync,
    timeoutSec = 1800,
    intervalSec = 30,
  }: {
    buildIds: string[];
    requestBuildsAsync?: (
      commandCtx: Pick<CommandContext, 'projectId'>,
      buildIds: string[]
    ) => Promise<(Build | string)[]>;
    timeoutSec?: number;
    intervalSec?: number;
  }
): Promise<(Build | null)[]> {
  logWaiting(buildIds.length);
  let time = new Date().getTime();
  const endTime = time + timeoutSec * 1000;

  const spinnies = new Spinnies();
  const unknownName = 'Pending';
  const stateCache: Record<string, BuildStatus> = {};

  while (time <= endTime) {
    const builds = await requestBuildsAsync(commandCtx, buildIds);

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
    await sleep(intervalSec * 1000);
  }

  spinnies.stopAll('stopped');

  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}

function getBuildDuration(build: Build & { metrics?: any }): number {
  if (build.metrics) {
    return build.metrics.buildEndTimestamp - build.metrics.buildStartTimestamp;
  }
  return 0;
}
