import { createFingerprintAsync, createFingerprintsByKeyAsync } from '../cli';

const mockCreateFingerprintAsync = jest.fn();

jest.mock('resolve-from', () => ({
  silent: jest.fn(() => 'expo/fingerprint'),
}));
jest.mock(
  'expo/fingerprint',
  () => ({
    createFingerprintAsync: mockCreateFingerprintAsync,
  }),
  { virtual: true }
);
jest.mock('../../ora', () => ({
  ora: () => ({
    start() {
      return this;
    },
    succeed: jest.fn(),
    fail: jest.fn(),
    stop: jest.fn(),
  }),
}));

describe('Fingerprint env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DOTENV_VALUE: 'from-parent',
      PARENT_DOTENV_VALUE: 'from-parent',
      FROM_PROCESS: 'true',
      NODE_ENV: 'production',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE","PARENT_DOTENV_VALUE"]',
      __EXPO_CONFIG_MODE: 'production',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('removes inherited dotenv values and uses development mode', async () => {
    const envBeforeFingerprint = process.env;
    const envValuesBeforeFingerprint = { ...process.env };
    const fingerprintEnv = {
      DOTENV_VALUE: 'from-eas',
      NODE_ENV: 'staging',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
      __EXPO_CONFIG_MODE: 'staging',
    };
    const fingerprintEnvBefore = { ...fingerprintEnv };
    mockCreateFingerprintAsync.mockImplementationOnce(async () => {
      expect(process.env).toMatchObject({
        DOTENV_VALUE: 'from-eas',
        FROM_PROCESS: 'true',
        NODE_ENV: 'development',
      });
      expect(process.env.PARENT_DOTENV_VALUE).toBeUndefined();
      expect(process.env.__EXPO_ENV_LOADED).toBeUndefined();
      expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
      return { hash: 'hash', sources: [] };
    });

    await createFingerprintAsync('/app', {
      platforms: ['ios'],
      env: fingerprintEnv,
    });

    expect(process.env).toBe(envBeforeFingerprint);
    expect(process.env).toEqual(envValuesBeforeFingerprint);
    expect(fingerprintEnv).toEqual(fingerprintEnvBefore);
  });

  it('restores process.env when one of multiple fingerprints fails', async () => {
    const envBeforeFingerprints = process.env;
    let rejectFirstFingerprint!: (error: Error) => void;
    let resolveSecondFingerprint!: (value: { hash: string; sources: never[] }) => void;
    mockCreateFingerprintAsync
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirstFingerprint = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecondFingerprint = resolve;
          })
      );

    const fingerprintsPromise = createFingerprintsByKeyAsync(
      '/app',
      new Map([
        ['ios', { platforms: ['ios'], env: undefined }],
        ['android', { platforms: ['android'], env: undefined }],
      ])
    );
    let didReject = false;
    const rejectionPromise = fingerprintsPromise.catch(error => {
      didReject = true;
      throw error;
    });

    rejectFirstFingerprint(new Error('fingerprint failed'));
    await new Promise(resolve => setImmediate(resolve));
    expect(didReject).toBe(false);

    resolveSecondFingerprint({ hash: 'android', sources: [] });
    await expect(rejectionPromise).rejects.toThrow('fingerprint failed');

    expect(process.env).toBe(envBeforeFingerprints);
  });
});
