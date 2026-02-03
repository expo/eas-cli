import { duplicates } from '../duplicates';

describe(duplicates, () => {
  it('returns empty list if there are no duplicates', () => {
    expect(duplicates([1, 2, 3, 4, 5, 6])).toEqual([]);
  });
  it('returns duplicates', () => {
    expect(duplicates([1, 2, 2, 3, 4, 4, 4, 5])).toEqual([2, 4]);
  });
  it('works with other item types too', () => {
    expect(duplicates(['1', '2', '2', '3', '4', '4', '4', '5'])).toEqual(['2', '4']);
    expect(duplicates([1, '2', '2', 3, 4, 4, 4, '5'])).toEqual(['2', 4]);
  });
});
