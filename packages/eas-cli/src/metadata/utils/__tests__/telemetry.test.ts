import { App, getRequestClient } from '@expo/apple-utils';

import { MetadataEvent } from '../../../analytics/events';
import { TelemetryContext, makeDataScrubber, withTelemetryAsync } from '../telemetry';

const stub: TelemetryContext = {
  // Only the App ID is considered to be sensitive
  app: new App({} as any, 'SECRET_APP_ID', {} as any),
  // Only the token properties and user credentials are considered to be sensitive
  auth: {
    username: 'SECRET_USERNAME',
    password: 'SECRET_PASSWORD',
    context: {
      token: 'SECRET_TOKEN',
      teamId: 'SECRET_TEAM_ID',
      providerId: 1337,
    },
  } as any,
};

describe(withTelemetryAsync, () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('disables telemetry when EXPO_NO_TELEMETRY is true', async () => {
    const { interceptors } = getRequestClient();
    const useInterceptor = jest.spyOn(interceptors.response, 'use');

    process.env['EXPO_NO_TELEMETRY'] = 'true';

    await withTelemetryAsync(MetadataEvent.APPLE_METADATA_UPLOAD, stub, async () => {
      return 'testing telemetry';
    });

    expect(useInterceptor).not.toBeCalled();
  });

  it('enables telemetry when EXPO_NO_TELEMETRY is undefined', async () => {
    const { interceptors } = getRequestClient();
    const useInterceptor = jest.spyOn(interceptors.response, 'use');

    process.env['EXPO_NO_TELEMETRY'] = undefined;

    await withTelemetryAsync(MetadataEvent.APPLE_METADATA_DOWNLOAD, stub, async () => {
      return 'testing telemetry';
    });

    expect(useInterceptor).toBeCalled();
  });

  it('detaches interceptors after action resolved', async () => {
    const { interceptors } = getRequestClient();
    const ejectInterceptor = jest.spyOn(interceptors.response, 'eject');

    await withTelemetryAsync(MetadataEvent.APPLE_METADATA_DOWNLOAD, stub, async () => {
      return 'testing resolved telemetry action';
    });

    expect(ejectInterceptor).toBeCalledWith(expect.any(Number));
  });

  it('detaches interceptors after action rejected', async () => {
    const { interceptors } = getRequestClient();
    const ejectInterceptor = jest.spyOn(interceptors.response, 'eject');

    try {
      await withTelemetryAsync(MetadataEvent.APPLE_METADATA_DOWNLOAD, stub, async () => {
        throw new Error('testing rejected telemetry action');
      });
    } catch {
      // intentional failure
    }

    expect(ejectInterceptor).toBeCalledWith(expect.any(Number));
  });

  it('adds executionId to thrown errors', async () => {
    let caughtError: null | Error = null;

    try {
      await withTelemetryAsync(MetadataEvent.APPLE_METADATA_DOWNLOAD, stub, async () => {
        throw new Error('testing exectution ID');
      });
    } catch (error: any) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError).toHaveProperty('executionId', expect.any(String));
  });
});

describe(makeDataScrubber, () => {
  it('scrubs the app.id', () => {
    expect(makeDataScrubber(stub)('some text SECRET_APP_ID')).toBe('some text {APPLE_APP_ID}');
  });

  it('scrubs the auth.username', () => {
    expect(makeDataScrubber(stub)('some text SECRET_USERNAME')).toBe('some text {APPLE_USERNAME}');
  });

  it('scrubs the auth.password', () => {
    expect(makeDataScrubber(stub)('SECRET_PASSWORD')).toBe('{APPLE_PASSWORD}');
  });

  it('scrubs the auth.context.token', () => {
    expect(makeDataScrubber(stub)('some text SECRET_TOKEN')).toBe('some text {APPLE_TOKEN}');
  });

  it('scrubs the auth.context.token when using token instances', () => {
    const token = { getToken: () => 'SECRET_TOKEN_INSTANCE' } as any;
    const scrubber = makeDataScrubber({
      ...stub,
      auth: {
        ...stub.auth,
        context: {
          ...stub.auth.context,
          token,
        },
      },
    });

    expect(scrubber('some text SECRET_TOKEN_INSTANCE')).toBe('some text {APPLE_TOKEN}');
  });

  it('scrubs the auth.context.teamId', () => {
    expect(makeDataScrubber(stub)('SECRET_TEAM_ID')).toBe('{APPLE_TEAM_ID}');
  });

  it('scrubs the auth.context.teamId', () => {
    expect(makeDataScrubber(stub)('some provider 1337')).toBe('some provider {APPLE_PROVIDER_ID}');
  });

  it('scrubber returns string representation of falsy values', () => {
    const scrubber = makeDataScrubber(stub);
    expect(scrubber(null)).toBe('null');
    expect(scrubber(undefined)).toBe('undefined');
    expect(scrubber(false)).toBe('false');
  });

  it('scrubs multiple sensitive values at once', () => {
    expect(makeDataScrubber(stub)('SECRET_TOKEN SECRET_USERNAME SECRET_PASSWORD')).toBe(
      '{APPLE_TOKEN} {APPLE_USERNAME} {APPLE_PASSWORD}'
    );
  });

  it('scrubs json and transforms it to string', () => {
    const scrubber = makeDataScrubber(stub);
    expect(scrubber({ foo: 'bar' })).toBe('{"foo":"bar"}');
    expect(scrubber({ value: 'SECRET_APP_ID' })).toBe('{"value":"{APPLE_APP_ID}"}');
  });
});
