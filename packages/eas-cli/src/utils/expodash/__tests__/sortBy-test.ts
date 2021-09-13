import sortBy from '../sortBy';

describe(sortBy, () => {
  it('sorts in ascending order by default', () => {
    const input = [
      { a: 4, b: 12 },
      { a: 2, b: 34 },
      { a: 3, b: 56 },
      { a: 1, b: 78 },
    ];
    expect(sortBy(input, 'a')).toEqual([
      { a: 1, b: 78 },
      { a: 2, b: 34 },
      { a: 3, b: 56 },
      { a: 4, b: 12 },
    ]);
  });
  it('can sort in descending order', () => {
    const input = [
      { a: 4, b: 12 },
      { a: 2, b: 34 },
      { a: 3, b: 56 },
      { a: 1, b: 78 },
    ];
    expect(sortBy(input, 'a', 'desc')).toEqual([
      { a: 4, b: 12 },
      { a: 3, b: 56 },
      { a: 2, b: 34 },
      { a: 1, b: 78 },
    ]);
  });
});
