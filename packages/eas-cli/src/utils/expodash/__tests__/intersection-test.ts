import intersection from '../intersection';

describe(intersection, () => {
  it('returns an empty list if the are no common items', () => {
    expect(intersection([1, 2, 3], [4, 5, 6])).toEqual([]);
  });
  it('returns a list with common items if the are some', () => {
    expect(intersection([1, 2, 3, 4], [3, 4, 5, 6])).toEqual([3, 4]);
  });
  it('works for empty lists', () => {
    expect(intersection([], [])).toEqual([]);
  });
});
