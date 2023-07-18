import capitalizeFirstLetter from '../capitalize';

describe(capitalizeFirstLetter, () => {
  it('capitalizes the string', () => {
    expect(capitalizeFirstLetter('dominik')).toBe('Dominik');
  });
  it('works with an empty string', () => {
    expect(capitalizeFirstLetter('')).toBe('');
  });
  it('does not change the case of other letters', () => {
    expect(capitalizeFirstLetter('inProgress')).toBe('InProgress');
  });
});
