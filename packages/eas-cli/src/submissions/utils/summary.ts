import chalk from 'chalk';

import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { Archive, ArchiveFileSourceType } from '../archiveSource';

export interface ArchiveSourceSummaryFields {
  archiveUrl?: string;
  archivePath?: string;
  buildId?: string;
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
      summarySlice.buildId = realFileSource.id;
      break;
    case ArchiveFileSourceType.latest:
      summarySlice.buildId = submittedBuildDetails?.buildId;
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
