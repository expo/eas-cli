import chalk from 'chalk';
import indentString from 'indent-string';

import { toDateOnly, toDateTime } from './formatTimespan';
import renderTextTable from '../utils/renderTextTable';

/** Each insights surface has its own generated enum with these values. */
export type InsightsGranularityValue = 'MINUTE' | 'HOUR' | 'DAY';

const INSIGHTS_GRANULARITY_PRESENTATION: Record<
  InsightsGranularityValue,
  {
    label: string;
    unitPlural: string;
    columnHeader: string;
    formatBucketStart: (isoTimestamp: string) => string;
  }
> = {
  MINUTE: {
    label: 'per minute, UTC',
    unitPlural: 'minutes',
    columnHeader: 'Time',
    formatBucketStart: toDateTime,
  },
  HOUR: {
    label: 'hourly, UTC',
    unitPlural: 'hours',
    columnHeader: 'Time',
    formatBucketStart: toDateTime,
  },
  DAY: {
    label: 'daily, UTC',
    unitPlural: 'days',
    columnHeader: 'Date',
    formatBucketStart: toDateOnly,
  },
};

/**
 * The server fills the whole window with buckets, so a quiet project would print one zero row
 * per period. Only the table omits them; the JSON output keeps every bucket.
 */
export function buildRunsOverTimeSection<Bucket extends { start: string }>(
  buckets: Bucket[],
  granularity: InsightsGranularityValue,
  {
    runs,
    columns,
    toRow,
  }: { runs: (bucket: Bucket) => number; columns: string[]; toRow: (bucket: Bucket) => string[] }
): string[] {
  const bucketsWithRuns = buckets.filter(bucket => runs(bucket) > 0);
  if (bucketsWithRuns.length === 0) {
    return [];
  }
  const presentation = INSIGHTS_GRANULARITY_PRESENTATION[granularity];
  const omittedNote =
    bucketsWithRuns.length < buckets.length
      ? `; ${presentation.unitPlural} with no runs omitted`
      : '';
  const table = renderTextTable(
    [presentation.columnHeader, ...columns],
    bucketsWithRuns.map(bucket => [presentation.formatBucketStart(bucket.start), ...toRow(bucket)])
  );
  return [
    '',
    chalk.bold(`Runs over time (${presentation.label}${omittedNote}):`),
    '',
    indentString(table, 2),
  ];
}
