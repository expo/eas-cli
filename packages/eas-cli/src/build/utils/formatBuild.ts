import chalk from 'chalk';

import { BuildFragment, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import formatFields from '../../utils/formatFields';
import { appPlatformDisplayNames } from '../constants';
import { getBuildLogsUrl } from './url';

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
          case GraphQLBuildStatus.New:
            return chalk.blue('new');
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
      label: 'Distribution',
      value: build.distribution?.toLowerCase() ?? chalk.gray('unknown'),
    },
    {
      label: 'Release Channel',
      value: build.releaseChannel ?? chalk.gray('unknown'),
    },
    {
      label: 'Logs',
      value: getBuildLogsUrl({ buildId: build.id, account }),
    },
    {
      label: 'Artifact',
      get value() {
        switch (build.status) {
          case GraphQLBuildStatus.New:
          case GraphQLBuildStatus.InQueue:
          case GraphQLBuildStatus.InProgress:
            return '<in progress>';
          case GraphQLBuildStatus.Canceled:
          case GraphQLBuildStatus.Errored:
            return '---------';
          case GraphQLBuildStatus.Finished: {
            const url = build.artifacts?.shortBuildUrl ?? build.artifacts?.buildUrl;
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
      value: [
        GraphQLBuildStatus.New,
        GraphQLBuildStatus.InQueue,
        GraphQLBuildStatus.InProgress,
      ].includes(build.status)
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
