import chalk from 'chalk';

/** A metric for the selected window and for the window of equal length right before it. */
export interface InsightsMetricSummary {
  current: number;
  previous: number;
}

export function toMetricSummary(metric: {
  currentValue: number;
  previousValue: number;
}): InsightsMetricSummary {
  return { current: metric.currentValue, previous: metric.previousValue };
}

export function ratePercent(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatCountWithTrend(
  metric: InsightsMetricSummary,
  options?: { lowerIsBetter?: boolean }
): string {
  return `${metric.current.toLocaleString()} (${formatTrend(metric, options)})`;
}

/** A rate with its change in percentage points. */
export function formatRateWithDelta(
  rate: InsightsMetricSummary,
  totalRuns: InsightsMetricSummary,
  { lowerIsBetter = false }: { lowerIsBetter?: boolean } = {}
): string {
  if (totalRuns.current === 0) {
    return chalk.dim('n/a');
  }
  if (totalRuns.previous === 0) {
    return `${formatPercent(rate.current)} (${chalk.dim('n/a')})`;
  }
  const delta = rate.current - rate.previous;
  return `${formatPercent(rate.current)} (${formatSignedChange(delta, ' pts', lowerIsBetter ? delta < 0 : delta > 0)})`;
}

/** A change from zero has no meaningful percentage. */
export function formatTrend(
  metric: InsightsMetricSummary,
  { lowerIsBetter = false }: { lowerIsBetter?: boolean } = {}
): string {
  if (metric.previous === 0) {
    return chalk.dim('n/a');
  }
  const pct = ((metric.current - metric.previous) / metric.previous) * 100;
  return formatSignedChange(pct, '%', lowerIsBetter ? pct < 0 : pct > 0);
}

function formatSignedChange(value: number, unit: string, isImprovement: boolean): string {
  if (value === 0) {
    return chalk.dim(`0.0${unit}`);
  }
  const text = `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}${unit}`;
  return isImprovement ? chalk.green(text) : chalk.red(text);
}
