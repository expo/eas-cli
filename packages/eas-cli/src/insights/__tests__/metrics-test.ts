import { formatRateWithDelta, formatTrend, ratePercent, toMetricSummary } from '../metrics';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe(toMetricSummary, () => {
  it('renames the server pair', () => {
    expect(toMetricSummary({ currentValue: 3, previousValue: 4 })).toEqual({
      current: 3,
      previous: 4,
    });
  });
});

describe(ratePercent, () => {
  it('returns 0 when there is nothing to rate', () => {
    expect(ratePercent(0, 0)).toBe(0);
  });

  it('returns the share as a percentage', () => {
    expect(ratePercent(3, 4)).toBe(75);
  });
});

describe(formatTrend, () => {
  it('is n/a when the previous period had no data', () => {
    expect(formatTrend({ current: 10, previous: 0 })).toContain('n/a');
  });

  it('formats the percentage change with a sign', () => {
    expect(formatTrend({ current: 125, previous: 100 })).toContain('+25.0%');
    expect(formatTrend({ current: 50, previous: 100 })).toContain('-50.0%');
    expect(formatTrend({ current: 100, previous: 100 })).toContain('0.0%');
  });
});

describe(formatRateWithDelta, () => {
  it('is n/a while there are no runs to rate', () => {
    expect(
      stripAnsi(formatRateWithDelta({ current: 0, previous: 50 }, { current: 0, previous: 10 }))
    ).toBe('n/a');
  });

  it('shows the rate without a delta when the previous period had no runs', () => {
    expect(
      stripAnsi(formatRateWithDelta({ current: 80, previous: 0 }, { current: 10, previous: 0 }))
    ).toBe('80.0% (n/a)');
  });

  it('shows the change in percentage points', () => {
    expect(
      stripAnsi(formatRateWithDelta({ current: 80, previous: 75.5 }, { current: 10, previous: 8 }))
    ).toBe('80.0% (+4.5 pts)');
  });
});
