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
          case BuildStatus.IN_PROGRESS:
            return chalk.blue('in progress');
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
        if (build.status === BuildStatus.IN_PROGRESS) {
          return '<in progress>';
        }

        const url = build.artifacts?.buildUrl;

        if (!url) {
          return chalk.red('not found');
        }

        return url;
      },
    },
    { label: 'Started at', value: new Date(build.createdAt).toLocaleString() },
    {
      label: 'Finished at',
      value:
        build.status === BuildStatus.IN_PROGRESS
          ? '<in progress>'
          : new Date(build.updatedAt).toLocaleString(),
    },
    // TODO: we can do it once we migrate to GraphQL
    // { label: 'Started by', get: build => 'TODO' },
  ];

  return formatFields(fields);
}
