import { BuildMode } from '../common';
import { ErrorCode, ExpoErrorType, UserFacingError, toBuildError } from '../errors';

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

describe(toBuildError, () => {
  it('converts UserFacingError to a user-type BuildError', () => {
    const err = toBuildError(new UserFacingError('EAS_BUILD_TEST_USER_ERROR', 'user message'));

    expect(err.type).toBe(ExpoErrorType.USER);
    expect(err.errorCode).toBe('EAS_BUILD_TEST_USER_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_TEST_USER_ERROR');
    expect(err.userFacingMessage).toBe('user message');
  });

  it('maps unknown custom errors to UNKNOWN_CUSTOM_BUILD_ERROR', () => {
    const err = toBuildError(new Error('oops'), { mode: BuildMode.CUSTOM });

    expect(err.type).toBe(ExpoErrorType.SYSTEM);
    expect(err.errorCode).toBe(ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR);
    expect(err.userFacingErrorCode).toBe(ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR);
  });
});
