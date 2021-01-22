import chalk from 'chalk';

import formatFields from '../../utils/formatFields';
import { platformDisplayNames } from '../constants';
import { Build, BuildStatus } from '../types';
import { getBuildLogsUrl } from './url';

interface Options {
  accountName: string;
}

export default function formatBuild(build: Build, { accountName }: Options) {
  const fields: { label: string; value: string }[] = [
    { label: 'ID', value: build.id },
    {
      label: 'Platform',
      value: platformDisplayNames[build.platform],
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
    // TODO: we can do it once we migrate to GraphQL
    // { label: 'Started by', get: build => 'TODO' },
  ];

  return formatFields(fields);
}
