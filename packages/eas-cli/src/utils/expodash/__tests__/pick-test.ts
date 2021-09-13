import pick from '../pick';

describe(pick, () => {
  it('returns an object with the subset of fields', () => {
    expect(pick({ a: 1, b: 2, c: 3, d: 4, e: 5 }, ['b', 'd'])).toEqual({ b: 2, d: 4 });
  });
});
