import chalk from 'chalk';

import { BuildFragment, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import formatFields from '../../utils/formatFields';
import { appPlatformDisplayNames, requestedPlatformDisplayNames } from '../constants';
import { Build, BuildStatus } from '../types';
import { getBuildLogsUrl } from './url';

interface Options {
  accountName: string;
}
/**
 * @deprecated remove this once we don't use REST endpoints for EAS Build
 */
export function formatBuild(build: Build, { accountName }: Options) {
  const fields: { label: string; value: string }[] = [
    { label: 'ID', value: build.id },
    {
      label: 'Platform',
      value: requestedPlatformDisplayNames[build.platform],
    },
    {
      label: 'Status',
      get value() {
        switch (build.status) {
          case BuildStatus.IN_QUEUE:
            return chalk.blue('in queue');
          case BuildStatus.IN_PROGRESS:
            return chalk.blue('in progress');
          case BuildStatus.CANCELED:
            return chalk.gray('canceled');
          case BuildStatus.FINISHED:
            return chalk.green('finished');
          case BuildStatus.ERRORED:
            return chalk.red('errored');
          default:
            return 'unknown';
        }
      },
    },
    {
      label: 'Logs',
      value: getBuildLogsUrl({ buildId: build.id, account: accountName }),
    },
    {
      label: 'Artifact',
      get value() {
        if (build.status === BuildStatus.IN_QUEUE || build.status === BuildStatus.IN_PROGRESS) {
        }
        switch (build.status) {
          case BuildStatus.IN_QUEUE:
          case BuildStatus.IN_PROGRESS:
            return '<in progress>';
          case BuildStatus.CANCELED:
          case BuildStatus.ERRORED:
            return '---------';
          case BuildStatus.FINISHED: {
            const url = build.artifacts?.buildUrl;
            return url ? url : chalk.red('not found');
          }
          default:
            return 'unknown';
        }
      },
    },
    { label: 'Started at', value: new Date(build.createdAt).toLocaleString() },
    {
      label: 'Finished at',
      value:
        build.status === BuildStatus.IN_QUEUE || build.status === BuildStatus.IN_PROGRESS
          ? '<in progress>'
          : new Date(build.updatedAt).toLocaleString(),
    },
  ];

  return formatFields(fields);
}

export function formatGraphQLBuild(build: BuildFragment) {
  const actor = getActorName(build);
  const account = build.project.__typename === 'App' ? build.project.ownerAccount.name : 'unknown';
  const fields: { label: string; value: string }[] = [
    { label: 'ID', value: build.id },
    {
      label: 'Platform',
      value: appPlatformDisplayNames[build.platform],
    },
    {
      label: 'Status',
      get value() {
        switch (build.status) {
          case GraphQLBuildStatus.InQueue:
            return chalk.blue('in queue');
          case GraphQLBuildStatus.InProgress:
            return chalk.blue('in progress');
          case GraphQLBuildStatus.Canceled:
            return chalk.gray('canceled');
          case GraphQLBuildStatus.Finished:
            return chalk.green('finished');
          case GraphQLBuildStatus.Errored:
            return chalk.red('errored');
          default:
            return 'unknown';
        }
      },
    },
    {
      label: 'Logs',
      value: getBuildLogsUrl({ buildId: build.id, account }),
    },
    {
      label: 'Artifact',
      get value() {
        if (
          build.status === GraphQLBuildStatus.InQueue ||
          build.status === GraphQLBuildStatus.InProgress
        ) {
        }
        switch (build.status) {
          case GraphQLBuildStatus.InQueue:
          case GraphQLBuildStatus.InProgress:
            return '<in progress>';
          case GraphQLBuildStatus.Canceled:
          case GraphQLBuildStatus.Errored:
            return '---------';
          case GraphQLBuildStatus.Finished: {
            const url = build.artifacts?.buildUrl;
            return url ? url : chalk.red('not found');
          }
          default:
            return 'unknown';
        }
      },
    },
    { label: 'Started at', value: new Date(build.createdAt).toLocaleString() },
    {
      label: 'Finished at',
      value:
        build.status === GraphQLBuildStatus.InQueue ||
        build.status === GraphQLBuildStatus.InProgress
          ? '<in progress>'
          : new Date(build.updatedAt).toLocaleString(),
    },
    { label: 'Started by', value: actor ?? 'unknown' },
  ];

  return formatFields(fields);
}

const getActorName = (build: BuildFragment): string => {
  if (!build.initiatingActor) {
    return 'unknown';
  } else if (build.initiatingActor.__typename === 'User') {
    return build.initiatingActor.username;
  } else {
    return build.initiatingActor.firstName ?? 'unknown';
  }
};
