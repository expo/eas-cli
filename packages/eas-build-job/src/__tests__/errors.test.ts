import { BuildError, ExpoError, UserFacingError } from '../errors';
import { BuildPhase } from '../logs';

class TestExpoError extends ExpoError {
  constructor(message: string, details: ConstructorParameters<typeof BuildError>[1]) {
    super(message, details);
  }
}

describe(ExpoError, () => {
  it('stores shared metadata and formats external payload', () => {
    const cause = new Error('root cause');
    const error = new TestExpoError('canonical message', {
      errorCode: 'ERR_CODE',
      trackingCode: 'TRACKING_CODE',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
      metadata: { packageName: '@typescript-eslint/typescript-estree' },
      cause,
    });

    expect(error.errorCode).toBe('ERR_CODE');
    expect(error.trackingCode).toBe('TRACKING_CODE');
    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.metadata).toEqual({
      packageName: '@typescript-eslint/typescript-estree',
    });
    expect(error.buildPhase).toBe(BuildPhase.PREBUILD);
    expect(error.cause).toBe(cause);
    expect(error.format()).toEqual({
      errorCode: 'ERR_CODE',
      message: 'canonical message',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
    });
  });
});

describe(BuildError, () => {
  it('formats using canonical message and errorCode', () => {
    const error = new BuildError('canonical message', {
      errorCode: 'ERR_CODE',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
      metadata: { packageName: '@expo/config' },
    });

    expect(error).toBeInstanceOf(ExpoError);
    expect(error.metadata).toEqual({ packageName: '@expo/config' });
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

    expect(error).toBeInstanceOf(ExpoError);
    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.cause).toBeUndefined();
  });

  it('supports cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserFacingError('ERR_CODE', 'message', { cause });

    expect(error.cause).toBe(cause);
  });

  it('supports docsUrl, metadata, and cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserFacingError('ERR_CODE', 'message', {
      docsUrl: 'https://docs.example.dev',
      metadata: { packageName: 'expo' },
      cause,
    });

    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.metadata).toEqual({ packageName: 'expo' });
    expect(error.cause).toBe(cause);
  });
});
