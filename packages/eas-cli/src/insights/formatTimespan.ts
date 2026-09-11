import dateFormat from 'dateformat';

export interface InsightsTimespanBounds {
  startTime: string;
  endTime: string;
}

export interface InsightsTimespanFields extends InsightsTimespanBounds {
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

export function toDateTime(isoTimestamp: string): string {
  return dateFormat(new Date(isoTimestamp), 'UTC:yyyy-mm-dd HH:MM');
}
