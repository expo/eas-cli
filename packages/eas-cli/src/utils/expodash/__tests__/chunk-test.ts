import chunk from '../chunk';

describe(chunk, () => {
  it('works with an empty list', () => {
    expect(chunk([])).toEqual([]);
  });

  it('works with list length undividable by chunk size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('works with list length dividable by chunk size', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });
});
