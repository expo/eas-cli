import { getError } from '../../__tests__/utils/error.js';
import { nullthrows } from '../nullthrows.js';

describe(nullthrows, () => {
  it('throws for null', () => {
    const error = getError<TypeError>(() => {
      nullthrows(null);
    });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/Expected value not to be null or undefined but got null/);
  });
  it('throws for undefined', () => {
    const error = getError<TypeError>(() => {
      nullthrows(undefined);
    });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/Expected value not to be null or undefined but got undefined/);
  });
  it('throws with custom message', () => {
    const error = getError<TypeError>(() => {
      nullthrows(undefined, 'blah blah');
    });
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      message: 'blah blah',
    });
  });
  it('does not throw for falsy values', () => {
    expect(() => {
      nullthrows(0);
      nullthrows('');
      nullthrows(false);
      nullthrows(NaN);
    }).not.toThrow();
  });
  it(`returns the value passed to the function if it's not null or undefined`, () => {
    expect(nullthrows(123)).toBe(123);
  });
});
