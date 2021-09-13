import capitalize from '../capitalize';

describe(capitalize, () => {
  it('capitalizes the string', () => {
    expect(capitalize('dominik')).toBe('Dominik');
  });
  it('works with an empty string', () => {
    expect(capitalize('')).toBe('');
  });
});
