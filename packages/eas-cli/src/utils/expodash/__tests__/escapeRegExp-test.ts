import escapeRegExp from '../escapeRegExp';

describe(escapeRegExp, () => {
  it('leaves a value without special characters alone', () => {
    expect(escapeRegExp('SECRET_PASSWORD')).toBe('SECRET_PASSWORD');
  });

  it('escapes every character with a meaning in a pattern', () => {
    expect(escapeRegExp('\\^$.*+?()[]{}|')).toBe('\\\\\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|');
  });

  it('makes a pattern that matches the value itself', () => {
    for (const value of ['user+eas@icloud.com', 'p+ssw0rd', 'S3cret(1', 'a.c', '^end$']) {
      expect(new RegExp(escapeRegExp(value)).test(value)).toBe(true);
    }
  });

  it('makes a pattern that matches nothing else', () => {
    expect(new RegExp(escapeRegExp('a.c')).test('abc')).toBe(false);
    expect(new RegExp(escapeRegExp('a+b')).test('aab')).toBe(false);
  });
});
