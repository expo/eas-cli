import { truthy } from '../filter';

describe(truthy, () => {
  it('filters 0 numbers', () => {
    expect([1, 0, -2, 2].filter(truthy)).toEqual([1, -2, 2]);
  });

  it('filters empty strings', () => {
    expect(['hello', '', 'world'].filter(truthy)).toEqual(['hello', 'world']);
  });

  it('filters null from strings or numbers', () => {
    expect(['hello', null, 1, ''].filter(truthy)).toEqual(['hello', 1]);
  });

  it('filters undefined from strings or numbers', () => {
    expect(['hello', undefined, 1, ''].filter(truthy)).toEqual(['hello', 1]);
  });
});
