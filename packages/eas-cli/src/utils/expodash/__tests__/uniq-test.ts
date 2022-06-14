import uniq from '../uniq';

describe(uniq, () => {
  it('returns unique numbers from a list', () => {
    expect(uniq([1, 2, 2, 3, 4, 2, 3])).toEqual([1, 2, 3, 4]);
  });

  it('returns unique strings from a list', () => {
    expect(uniq(['hi', 'hello', 'hello', 'ola'])).toEqual(['hi', 'hello', 'ola']);
  });

  it('returns unique mixed types from a list', () => {
    expect(uniq([1, 2, 2, 'hi', 'hi', 'hello', 3])).toEqual([1, 2, 'hi', 'hello', 3]);
  });
});
