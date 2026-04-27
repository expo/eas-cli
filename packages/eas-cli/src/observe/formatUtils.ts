/**
 * Format an ISO timestamp for display in event tables, including
 * seconds and milliseconds.
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
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
 * Format an ISO timestamp for display as a date only (no time).
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
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
