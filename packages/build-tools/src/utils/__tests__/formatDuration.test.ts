import { formatSecondsForLog } from '../formatDuration';

describe(formatSecondsForLog, () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [45, '45 seconds'],
    [60, '1 minute'],
    [90, '1 minute 30 seconds'],
    [120, '2 minutes'],
    [3600, '1 hour'],
    [3661, '1 hour 1 minute 1 second'],
    [7200, '2 hours'],
  ] as const)('formats %i as %s', (seconds, expected) => {
    expect(formatSecondsForLog(seconds)).toBe(expected);
  });
});
