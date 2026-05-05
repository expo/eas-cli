import dateFormat from 'dateformat';

export interface InsightsTimespanFields {
  startTime: string;
  endTime: string;
  daysBack?: number;
}

export function formatTimespan(timespan: InsightsTimespanFields): string {
  if (timespan.daysBack) {
    return `last ${timespan.daysBack} day${timespan.daysBack === 1 ? '' : 's'}`;
  }
  return `${toDateOnly(timespan.startTime)} to ${toDateOnly(timespan.endTime)}`;
}

export function toDateOnly(isoTimestamp: string): string {
  return dateFormat(new Date(isoTimestamp), 'UTC:yyyy-mm-dd');
}
