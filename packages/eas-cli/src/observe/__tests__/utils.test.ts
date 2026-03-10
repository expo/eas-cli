import { validateDateFlag } from '../utils';

describe(validateDateFlag, () => {
  it('throws on invalid --start date', () => {
    expect(() => validateDateFlag('not-a-date', '--start')).toThrow(
      'Invalid --start date: "not-a-date"'
    );
  });

  it('throws on invalid --end date', () => {
    expect(() => validateDateFlag('also-bad', '--end')).toThrow('Invalid --end date: "also-bad"');
  });

  it('accepts valid ISO date in --start', () => {
    expect(() => validateDateFlag('2025-01-01', '--start')).not.toThrow();
  });
});
