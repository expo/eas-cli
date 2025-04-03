import { App } from '@expo/apple-utils';

import { TelemetryContext, makeDataScrubberAsync } from '../telemetry';

describe(makeDataScrubberAsync, () => {
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

  it('scrubs the app.id', async () => {
    expect((await makeDataScrubberAsync(stub))('some text SECRET_APP_ID')).toBe(
      'some text {APPLE_APP_ID}'
    );
  });

  it('scrubs the auth.username', async () => {
    expect((await makeDataScrubberAsync(stub))('some text SECRET_USERNAME')).toBe(
      'some text {APPLE_USERNAME}'
    );
  });

  it('scrubs the auth.password', async () => {
    expect((await makeDataScrubberAsync(stub))('SECRET_PASSWORD')).toBe('{APPLE_PASSWORD}');
  });

  it('scrubs the auth.context.token', async () => {
    expect((await makeDataScrubberAsync(stub))('some text SECRET_TOKEN')).toBe(
      'some text {APPLE_TOKEN}'
    );
  });

  it('scrubs the auth.context.token when using token instances', async () => {
    const token = { getToken: () => 'SECRET_TOKEN_INSTANCE' } as any;
    const scrubber = await makeDataScrubberAsync({
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

  it('scrubs the auth.context.teamId', async () => {
    expect((await makeDataScrubberAsync(stub))('SECRET_TEAM_ID')).toBe('{APPLE_TEAM_ID}');
  });

  it('scrubs the auth.context.teamId', async () => {
    expect((await makeDataScrubberAsync(stub))('some provider 1337')).toBe(
      'some provider {APPLE_PROVIDER_ID}'
    );
  });

  it('scrubber returns string representation of falsy values', async () => {
    const scrubber = await makeDataScrubberAsync(stub);
    expect(scrubber(null)).toBe('null');
    expect(scrubber(undefined)).toBe('undefined');
    expect(scrubber(false)).toBe('false');
  });

  it('scrubs multiple sensitive values at once', async () => {
    expect(
      (await makeDataScrubberAsync(stub))('SECRET_TOKEN SECRET_USERNAME SECRET_PASSWORD')
    ).toBe('{APPLE_TOKEN} {APPLE_USERNAME} {APPLE_PASSWORD}');
  });

  it('scrubs json and transforms it to string', async () => {
    const scrubber = await makeDataScrubberAsync(stub);
    expect(scrubber({ foo: 'bar' })).toBe('{"foo":"bar"}');
    expect(scrubber({ value: 'SECRET_APP_ID' })).toBe('{"value":"{APPLE_APP_ID}"}');
  });
});
