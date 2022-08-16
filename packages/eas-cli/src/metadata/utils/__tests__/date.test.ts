import { removeDatePrecision } from '../date';

describe(removeDatePrecision, () => {
  it('returns null for falsy values', () => {
    expect(removeDatePrecision(null)).toBeNull();
    expect(removeDatePrecision(undefined)).toBeNull();
  });

  it('returns null for invalid dates', () => {
    expect(removeDatePrecision('invalid-date')).toBeNull();
  });

  it('returns date from date instance without time precision', () => {
    const input = new Date('2022-06-01T11:46:29.850Z');
    const output = new Date('2022-06-01T11:00:00.000Z');
    expect(removeDatePrecision(input)?.toISOString()).toBe(output.toISOString());
  });

  it('returns date from string instance without time precision', () => {
    const input = '2022-06-01T11:46:29.850Z';
    const output = '2022-06-01T11:00:00.000Z';
    expect(removeDatePrecision(input)?.toISOString()).toBe(output);
  });
});
