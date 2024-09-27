import chalk from 'chalk';

import { AppPlatform, BuildFragment } from '../../graphql/generated';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { ArchiveSourceType, ResolvedArchiveSource } from '../ArchiveSource';
export interface ArchiveSourceSummaryFields {
  archiveUrl?: string;
  archivePath?: string;
  formattedBuild?: string;
}

function formatSubmissionBuildSummary(build: BuildFragment): string {
  const fields = [
    {
      label: 'Build ID',
      value: build.id,
    },
    {
      label: 'Build Date',
      value: new Date(build.createdAt).toLocaleString(),
    },
    {
      label: 'App Version',
      value: build.appVersion,
    },
    {
      label: build.platform === AppPlatform.Android ? 'Version code' : 'Build number',
      value: build.appBuildVersion,
    },
  ];

  const filteredFields = fields.filter(({ value }) => value !== undefined && value !== null) as {
    label: string;
    value: string;
  }[];

  return (
    '\n' +
    formatFields(filteredFields, {
      labelFormat: label => `    ${chalk.dim(label)}:`,
    })
  );
}

export function formatArchiveSourceSummary(
  archive: ResolvedArchiveSource
): ArchiveSourceSummaryFields {
  const summarySlice: ArchiveSourceSummaryFields = {};

  switch (archive.sourceType) {
    case ArchiveSourceType.gcs:
      summarySlice.archivePath = archive.localSource.path;
      break;
    case ArchiveSourceType.url:
      summarySlice.archiveUrl = archive.url;
      break;
    case ArchiveSourceType.build:
      summarySlice.formattedBuild = formatSubmissionBuildSummary(archive.build);
      break;
  }
  return summarySlice;
}

export function printSummary<T extends object>(summary: T, keyMap: Record<keyof T, string>): void {
  const fields = [];
  for (const [key, value] of Object.entries(summary)) {
    const label = `${keyMap[key as keyof T]}:`;
    fields.push({ label, value });
  }

  Log.addNewLineIfNone();
  Log.log(formatFields(fields, { labelFormat: chalk.bold.cyan }));
  Log.addNewLineIfNone();
}
