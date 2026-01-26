import omit from '../omit';

describe(omit, () => {
  it('omits specified keys from an object', () => {
    const original = { a: 1, b: 2, c: 3 };
    const result = omit(original, ['b', 'c']);
    expect(result).toEqual({ a: 1 });
  });

  it('returns the same object if no keys are specified', () => {
    const original = { a: 1, b: 2, c: 3 };
    const result = omit(original, []);
    expect(result).toEqual(original);
  });

  it('handles non-existent keys gracefully', () => {
    const original = { a: 1, b: 2, c: 3 };
    const result = omit(original, ['d', 'e'] as any);
    expect(result).toEqual(original);
  });
});
