import chalk from 'chalk';

import { platformDisplayNames } from '../constants';
import { Build, BuildStatus } from '../types';
import { getBuildLogsUrl } from './url';

interface Options {
  accountName: string;
}

export default function formatBuild(build: Build, { accountName }: Options) {
  const fields: { label: string; get: (build: Build) => string }[] = [
    { label: 'ID', get: build => build.id },
    {
      label: 'Platform',
      get: build => platformDisplayNames[build.platform],
    },
    {
      label: 'Status',
      get: build => {
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
      get: build => getBuildLogsUrl({ buildId: build.id, account: accountName }),
    },
    {
      label: 'Artifact',
      get: build => {
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
    { label: 'Started at', get: build => new Date(build.createdAt).toLocaleString() },
    {
      label: 'Finished at',
      get: build =>
        build.status === BuildStatus.IN_PROGRESS
          ? '<in progress>'
          : new Date(build.updatedAt).toLocaleString(),
    },
    // TODO: we can do it once we migrate to GraphQL
    // { label: 'Started by', get: build => 'TODO' },
  ];

  const columnWidth = fields.reduce((a, b) => (a.label.length > b.label.length ? a : b)).label
    .length;

  return fields
    .map(({ label, get }) => {
      let line = '';

      line += chalk.dim(
        label.length < columnWidth ? `${label}${' '.repeat(columnWidth - label.length)}` : label
      );

      line += '  ';
      line += get(build);

      return line;
    })
    .join('\n');
}
