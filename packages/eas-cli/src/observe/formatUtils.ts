/**
 * Format an ISO timestamp for display in event tables (minute precision).
 * Uses the runtime's default locale.
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format an ISO timestamp for display in log tables (millisecond precision).
 * Use this instead of formatTimestamp when the table represents individual
 * log entries where sub-minute resolution matters. Uses the runtime's
 * default locale.
 */
export function formatLogTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

/**
 * Format an ISO timestamp for display as a date only (no time). Uses the
 * runtime's default locale.
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Build the time-range fragment used in summary headers, e.g.
 * "for the last 7 days" or "from Jan 1, 2025 to Feb 1, 2025".
 * Returns an empty string when no range information is provided.
 */
export function buildTimeRangeDescription(options: {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
}): string {
  if (options.daysBack) {
    return `for the last ${options.daysBack} days`;
  }
  if (options.startTime && options.endTime) {
    return `from ${formatDate(options.startTime)} to ${formatDate(options.endTime)}`;
  }
  return '';
}
