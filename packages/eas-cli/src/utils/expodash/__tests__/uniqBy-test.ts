import uniqBy from '../uniqBy';

describe(uniqBy, () => {
  it('returns unique items from the list', () => {
    expect(
      uniqBy(
        [
          { a: 1, b: 78 },
          { a: 2, b: 34 },
          { a: 2, b: 56 },
          { a: 4, b: 12 },
        ],
        ({ a }) => a
      )
    ).toEqual([
      { a: 1, b: 78 },
      { a: 2, b: 34 },
      { a: 4, b: 12 },
    ]);
  });

  it('calls getKey once per item', () => {
    const getKey = jest.fn(({ a }: { a: number }) => a);

    uniqBy([{ a: 1 }, { a: 2 }, { a: 2 }], getKey);

    expect(getKey).toHaveBeenCalledTimes(3);
  });
});
