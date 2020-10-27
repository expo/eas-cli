import { isValidUDID, normalizeUDID } from '../udids';

describe(isValidUDID, () => {
  test('valid 40-character UDID', () => {
    expect(isValidUDID('d341689fc9567d24f7fff0c29b1d3104f131cf39')).toBe(true);
  });
  test('invalid 40-character UDID (with special characters)', () => {
    expect(isValidUDID('$!@1689fc9567d24f7fff0c29b1d3104f131cf39')).toBe(false);
  });
  test('valid 25-character UDID', () => {
    expect(isValidUDID('00009999-000D6666146B888E')).toBe(true);
  });
  test('invalid 25-character UDID (without - after 8th character)', () => {
    expect(isValidUDID('000099993000D6666146B888E')).toBe(false);
  });
  test('invalid UDID', () => {
    expect(isValidUDID('ABC')).toBe(false);
  });
});

describe(normalizeUDID, () => {
  it('trims the input string', () => {
    expect(normalizeUDID('   00009999-000D6666146B888E   ')).toBe('00009999-000D6666146B888E');
  });
  it('converts the input to uppercase if passed a 25-character string', () => {
    expect(normalizeUDID('00009999-000d6666146b888e')).toBe('00009999-000D6666146B888E');
  });
  it('converts the input to lowercase if passed a 40-character string', () => {
    expect(normalizeUDID('D341689FC9567D24F7FFF0C29B1D3104F131CF39')).toBe(
      'd341689fc9567d24f7fff0c29b1d3104f131cf39'
    );
  });
  it('returns the same string if the input is not 25 nor 40 characters long', () => {
    expect(normalizeUDID('abcABC123xYz')).toBe('abcABC123xYz');
  });
});
