import { BuildError, UserFacingError } from '../errors';
import { BuildPhase } from '../logs';

describe(BuildError, () => {
  it('formats using canonical message and errorCode', () => {
    const error = new BuildError('canonical message', {
      errorCode: 'ERR_CODE',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
    });

    expect(error.format()).toEqual({
      errorCode: 'ERR_CODE',
      message: 'canonical message',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
    });
  });
});

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
