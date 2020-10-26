import { isValidUDID } from '../udids';

describe(isValidUDID, () => {
  test('valid 40-character UDID', () => {
    expect(isValidUDID('d341689fc9567d24f7fff0c29b1d3104f131cf39')).toBe(true);
  });
  test('invalid 40-character UDID (with special characters)', () => {
    expect(isValidUDID('$!@1689fc9567d24f7fff0c29b1d3104f131cf39')).toBe(false);
  });
  test('valid 20-character UDID', () => {
    expect(isValidUDID('00009999-000D6666146B888E')).toBe(true);
  });
  test('invalid 20-character UDID (without - after 8th character)', () => {
    expect(isValidUDID('000099993000D6666146B888E')).toBe(false);
  });
  test('invalid UDID', () => {
    expect(isValidUDID('ABC')).toBe(false);
  });
});
