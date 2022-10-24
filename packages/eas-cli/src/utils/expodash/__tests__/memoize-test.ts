import { memoize } from '../memoize';

describe(memoize, () => {
  it(`memoizes`, () => {
    const fn = jest.fn(() => 'd');
    const memoized = memoize(fn);
    expect(memoized()).toEqual('d');
    expect(memoized()).toEqual('d');
    expect(memoized()).toEqual('d');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
