import { UserFacingError } from '../errors';

describe(UserFacingError, () => {
  it('supports docsUrl in options', () => {
    const error = new UserFacingError('ERR_CODE', 'message', {
      docsUrl: 'https://docs.example.dev',
    });

    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.cause).toBeUndefined();
  });

  it('supports cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserFacingError('ERR_CODE', 'message', { cause });

    expect(error.cause).toBe(cause);
  });

  it('supports docsUrl and cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserFacingError('ERR_CODE', 'message', {
      docsUrl: 'https://docs.example.dev',
      cause,
    });

    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.cause).toBe(cause);
  });

});
