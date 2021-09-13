import zipObject from '../zipObject';

describe(zipObject, () => {
  it('throws if the number of items does not match', () => {
    expect(() => zipObject(['a', 'b', 'c'], [1, 2])).toThrowError(/does not match/);
  });
  it('creates an object using keys and values from the provided lists', () => {
    expect(zipObject(['a', 'b', 'c'], [1, 2, 3])).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });
});
