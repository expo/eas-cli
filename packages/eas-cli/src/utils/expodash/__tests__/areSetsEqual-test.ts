import areSetsEqual from '../areSetsEqual';

describe(areSetsEqual, () => {
  it.each([
    [new Set([1, 2]), new Set([1, 2])],
    [new Set([1, 2]), new Set([2, 1])],
  ])('equal cases: %p', (a, b) => {
    expect(areSetsEqual(a, b)).toBe(true);
  });

  it.each([
    [new Set([1, 2, 3]), new Set([1, 2])],
    [new Set([1, 2]), new Set([1, 2, 3])],
  ])('non-equal cases: %p', (a, b) => {
    expect(areSetsEqual(a, b)).toBe(false);
  });
});
