import filter from '../filter';

describe(filter, () => {
  it('returns all numbers', () => {
    expect(filter([1, 0, 2])).toEqual([1, 0, 2]);
  });

  it('returns all strings', () => {
    expect(filter(['hello', '', 'world'])).toEqual(['hello', '', 'world']);
  });

  it('filters null from list', () => {
    expect(filter(['hello', null, 0, ''])).toEqual(['hello', 0, '']);
  });

  it('filters undefined from list', () => {
    expect(filter(['hello', undefined, 0, ''])).toEqual(['hello', 0, '']);
  });
});
