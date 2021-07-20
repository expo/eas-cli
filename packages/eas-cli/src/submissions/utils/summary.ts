import chalk from 'chalk';

import { AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { Archive, ArchiveFileSourceType } from '../archiveSource';
import { SubmittedBuildInfo } from './builds';

export interface ArchiveSourceSummaryFields {
  archiveUrl?: string;
  archivePath?: string;
  submittedBuildDetails?: string;
}

function formatSubmittedBuildSummary(info: SubmittedBuildInfo) {
  const fields = [
    {
      label: 'Build ID',
      value: info.buildId,
    },
    {
      label: 'Build Date',
      value: new Date(info.createdAt).toLocaleString(),
    },
    {
      label: 'App Version',
      value: info.appVersion,
    },
    {
      label: info.platform === AppPlatform.Android ? 'Version code' : 'Build number',
      value: info.appBuildVersion,
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

export function formatArchiveSourceSummary({
  realFileSource,
  submittedBuildDetails,
}: Archive): ArchiveSourceSummaryFields {
  const summarySlice: ArchiveSourceSummaryFields = {};

  switch (realFileSource.sourceType) {
    case ArchiveFileSourceType.path:
      summarySlice.archivePath = realFileSource.path;
      break;
    case ArchiveFileSourceType.url:
      summarySlice.archiveUrl = realFileSource.url;
      break;
    case ArchiveFileSourceType.buildId:
    case ArchiveFileSourceType.latest:
      summarySlice.submittedBuildDetails = formatSubmittedBuildSummary(submittedBuildDetails!);
      break;
  }
  return summarySlice;
}

export function printSummary<T>(
  summary: T,
  keyMap: Record<keyof T, string>,
  valueRemap: Partial<Record<keyof T, Function>>
): void {
  const fields = [];
  for (const [key, entryValue] of Object.entries(summary)) {
    const label = `${keyMap[key as keyof T]}:`;
    const value = valueRemap[key as keyof T]?.(entryValue) ?? entryValue;
    fields.push({ label, value });
  }

  Log.newLine();
  Log.log(formatFields(fields, { labelFormat: chalk.bold.cyan }));
  Log.addNewLineIfNone();
}
