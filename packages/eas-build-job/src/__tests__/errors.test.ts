import { ErrorCode, ExpoError, SystemError, UserError } from '../errors';
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
    expect(error.toExternalExpoError()).toEqual({
      errorCode: 'ERR_CODE',
      message: 'canonical message',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
    });
  });
});

describe(UserError, () => {
  it('supports docsUrl in options', () => {
    const error = new UserError('ERR_CODE', 'message', {
      docsUrl: 'https://docs.example.dev',
    });

    expect(error).toBeInstanceOf(ExpoError);
    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.cause).toBeUndefined();
  });

  it('supports cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserError('ERR_CODE', 'message', { cause });

    expect(error.cause).toBe(cause);
  });

  it('supports trackingCode and buildPhase in options', () => {
    const error = new UserError('ERR_CODE', 'message', {
      trackingCode: 'TRACKING_CODE',
      buildPhase: BuildPhase.PREBUILD,
    });

    expect(error.trackingCode).toBe('TRACKING_CODE');
    expect(error.buildPhase).toBe(BuildPhase.PREBUILD);
  });

  it('supports docsUrl, metadata, and cause in options', () => {
    const cause = new Error('root cause');
    const error = new UserError('ERR_CODE', 'message', {
      docsUrl: 'https://docs.example.dev',
      metadata: { packageName: 'expo' },
      cause,
    });

    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.metadata).toEqual({ packageName: 'expo' });
    expect(error.cause).toBe(cause);
  });
});

describe(SystemError, () => {
  it('always formats with SERVER_ERROR and preserves trackingCode', () => {
    const cause = new Error('root cause');
    const error = new SystemError('system message', {
      trackingCode: 'TRACKING_CODE',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
      metadata: { packageName: '@expo/config' },
      cause,
    });

    expect(error).toBeInstanceOf(ExpoError);
    expect(error.errorCode).toBe(ErrorCode.SERVER_ERROR);
    expect(error.trackingCode).toBe('TRACKING_CODE');
    expect(error.docsUrl).toBe('https://docs.example.dev');
    expect(error.metadata).toEqual({ packageName: '@expo/config' });
    expect(error.buildPhase).toBe(BuildPhase.PREBUILD);
    expect(error.cause).toBe(cause);
    expect(error.toExternalExpoError()).toEqual({
      errorCode: ErrorCode.SERVER_ERROR,
      message: 'system message',
      docsUrl: 'https://docs.example.dev',
      buildPhase: BuildPhase.PREBUILD,
    });
  });
});
