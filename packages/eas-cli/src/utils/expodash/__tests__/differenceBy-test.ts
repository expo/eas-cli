import differenceBy from '../differenceBy.js';

describe(differenceBy, () => {
  it('removes items from the first list that also appear on the second list', () => {
    expect(
      differenceBy([{ i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }], [{ i: 2 }, { i: 4 }], 'i')
    ).toEqual([{ i: 1 }, { i: 3 }, { i: 5 }]);
  });
});
