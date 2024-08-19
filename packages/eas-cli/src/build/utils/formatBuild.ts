import chalk from 'chalk';

import { getBuildLogsUrl } from './url';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus as GraphQLBuildStatus,
} from '../../graphql/generated';
import { appPlatformDisplayNames } from '../../platform';
import formatFields from '../../utils/formatFields';

export function formatGraphQLBuild(build: BuildFragment): string {
  const actor = getActorName(build);
  const fields: { label: string; value?: string | null }[] = [
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
          case GraphQLBuildStatus.PendingCancel:
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
      label: 'Profile',
      value: build.buildProfile,
    },
    {
      label: 'Message',
      value: build.message,
    },
    {
      label: 'Distribution',
      value: build.distribution?.toLowerCase(),
    },
    {
      label: 'Enterprise Provisioning',
      value: build.iosEnterpriseProvisioning?.toLowerCase(),
    },
    {
      label: 'Channel',
      value: build.channel,
    },
    {
      label: 'SDK Version',
      value: build.sdkVersion,
    },
    {
      label: 'Runtime Version',
      value: build.runtimeVersion,
    },
    {
      label: 'Version',
      value: build.appVersion,
    },
    {
      label: build.platform === AppPlatform.Android ? 'Version code' : 'Build number',
      value: build.appBuildVersion,
    },
    {
      label: 'Commit',
      value: build.gitCommitHash,
    },
    {
      label: 'Logs',
      value: getBuildLogsUrl(build),
    },
    {
      label: 'Artifact',
      get value() {
        switch (build.status) {
          case GraphQLBuildStatus.New:
          case GraphQLBuildStatus.InQueue:
          case GraphQLBuildStatus.InProgress:
            return '<in progress>';
          case GraphQLBuildStatus.PendingCancel:
          case GraphQLBuildStatus.Canceled:
          case GraphQLBuildStatus.Errored:
            return null;
          case GraphQLBuildStatus.Finished: {
            const url = build.artifacts?.buildUrl;
            return url ? url : chalk.red('not found');
          }
          default:
            return null;
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

  const filteredFields = fields.filter(({ value }) => value !== undefined && value !== null) as {
    label: string;
    value: string;
  }[];
  return formatFields(filteredFields);
}

const getActorName = (build: BuildFragment): string => {
  return build.initiatingActor?.displayName || 'unknown';
};
