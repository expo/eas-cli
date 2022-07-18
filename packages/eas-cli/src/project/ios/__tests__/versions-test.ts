import { getNextBuildNumber, isValidBuildNumber } from '../versions';

describe(isValidBuildNumber, () => {
  test('isValidBuildNumber()', () => {
    expect(isValidBuildNumber('1.2.3')).toBe(true);
    expect(isValidBuildNumber('1.2')).toBe(true);
    expect(isValidBuildNumber('1')).toBe(true);
    expect(isValidBuildNumber('1.2.3.4')).toBe(false);
    expect(isValidBuildNumber('1.2.-3')).toBe(false);
    expect(isValidBuildNumber('1.a.3')).toBe(false);
  });
});

describe(getNextBuildNumber, () => {
  test('getNextBuildNumber', () => {
    expect(getNextBuildNumber('1.2.3')).toBe('1.2.4');
    expect(getNextBuildNumber('1.2')).toBe('1.3');
    expect(getNextBuildNumber('1')).toBe('2');
    expect(() => getNextBuildNumber('1.2.3.4')).toThrowError();
  });
});
