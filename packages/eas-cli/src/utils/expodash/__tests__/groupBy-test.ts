import groupBy from '../groupBy.js';

describe(groupBy, () => {
  it('groups the objects from the list', () => {
    const list = [
      { a: 1, b: 11 },
      { a: 2, b: 22 },
      { a: 1, b: 33 },
    ];
    expect(groupBy(list, ({ a }) => a)).toEqual({
      1: [
        { a: 1, b: 11 },
        { a: 1, b: 33 },
      ],
      2: [{ a: 2, b: 22 }],
    });
  });
});
