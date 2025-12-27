import { splitArgsString } from '../local';

describe('splitArgsString', () => {
  test('splits on spaces', () => {
    expect(splitArgsString('a b c')).toEqual(['a', 'b', 'c']);
  });

  test('respects double quotes', () => {
    expect(splitArgsString('a "b c" d')).toEqual(['a', 'b c', 'd']);
  });

  test('respects single quotes', () => {
    expect(splitArgsString("a 'b c' d")).toEqual(['a', 'b c', 'd']);
  });

  test('handles mixed quotes and unquoted', () => {
    expect(splitArgsString('--option=1 "value with spaces" \'other val\' plain')).toEqual([
      '--option=1',
      'value with spaces',
      'other val',
      'plain',
    ]);
  });

  test('returns empty array for empty string', () => {
    expect(splitArgsString('')).toEqual([]);
  });
});
