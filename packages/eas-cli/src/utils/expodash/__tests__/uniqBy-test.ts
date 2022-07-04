import uniqBy from '../uniqBy.js';

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
});
