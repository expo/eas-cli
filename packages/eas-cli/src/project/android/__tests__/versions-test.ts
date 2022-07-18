import { getNextVersionCode, isValidVersionCode } from '../versions';

describe(isValidVersionCode, () => {
  test('isValidVersionCode()', () => {
    expect(isValidVersionCode(123)).toBe(true);
    expect(isValidVersionCode(12.3)).toBe(false);
    expect(isValidVersionCode(-123)).toBe(false);
    expect(isValidVersionCode(2000000000)).toBe(true);
    expect(isValidVersionCode(2000000001)).toBe(false);
    expect(isValidVersionCode('123')).toBe(true);
    expect(isValidVersionCode('12.3')).toBe(false);
    expect(isValidVersionCode('-123')).toBe(false);
    expect(isValidVersionCode('2000000000')).toBe(true);
    expect(isValidVersionCode('2000000001')).toBe(false);
  });
});

describe(getNextVersionCode, () => {
  test('getNextVersionCode()', () => {
    expect(getNextVersionCode(123)).toBe(124);
    expect(() => getNextVersionCode(12.3)).toThrowError();
    expect(getNextVersionCode(1999999999)).toBe(2000000000);
    expect(() => getNextVersionCode(2000000000)).toThrowError();
    expect(getNextVersionCode('123')).toBe(124);
    expect(() => getNextVersionCode('12.3')).toThrowError();
  });
});
