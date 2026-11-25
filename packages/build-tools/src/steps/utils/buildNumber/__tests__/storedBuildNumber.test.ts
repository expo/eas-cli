import { Platform, SystemError, UserError } from '@expo/eas-build-job';
import { Client, CombinedError, stringifyDocument } from '@urql/core';

import { readStoredBuildNumberAsync, storeBuildNumberAsync } from '../storedBuildNumber';

const APP_ID = 'app-id';
const KEY = {
  appId: APP_ID,
  platform: Platform.IOS,
  applicationIdentifier: 'dev.expo.nativeapp',
};

function createGraphqlClient(...results: object[]): Client {
  const toPromise = jest.fn();
  for (const result of results) {
    toPromise.mockResolvedValueOnce(result);
  }
  return {
    query: jest.fn(() => ({ toPromise })),
    mutation: jest.fn(() => ({ toPromise })),
  } as unknown as Client;
}

function latestAppVersionResult(appVersion: object | null): object {
  return {
    data: {
      app: { byId: { id: APP_ID, latestAppVersionByPlatformAndApplicationIdentifier: appVersion } },
    },
  };
}

async function readAsync(graphqlClient: Client): Promise<string | undefined> {
  return await readStoredBuildNumberAsync(graphqlClient, KEY);
}

const unauthorizedError = new CombinedError({
  graphQLErrors: [
    {
      message: 'Entity Not Authorized',
      extensions: { errorCode: 'UNAUTHORIZED_ERROR', isTransient: false },
    },
  ],
});

afterEach(() => {
  jest.useRealTimers();
});

describe(readStoredBuildNumberAsync, () => {
  it('returns the build number of the latest record of the platform and the application identifier', async () => {
    const graphqlClient = createGraphqlClient(
      latestAppVersionResult({ id: 'app-version-id', buildVersion: '42' })
    );

    await expect(readAsync(graphqlClient)).resolves.toBe('42');
    const [query, variables] = jest.mocked(graphqlClient.query).mock.calls[0];
    expect(variables).toEqual({ ...KEY, platform: 'IOS' });
    expect(stringifyDocument(query)).toMatch(
      /latestAppVersionByPlatformAndApplicationIdentifier\(\s*platform: \$platform\s+applicationIdentifier: \$applicationIdentifier\s*\)/
    );
  });

  it('returns nothing when EAS stores no record for the application identifier', async () => {
    const graphqlClient = createGraphqlClient(latestAppVersionResult(null));

    await expect(readAsync(graphqlClient)).resolves.toBeUndefined();
  });

  it('reads again after a failure of the network', async () => {
    jest.useFakeTimers();
    const graphqlClient = createGraphqlClient(
      { error: new CombinedError({ networkError: new TypeError('fetch failed') }) },
      latestAppVersionResult({ id: 'app-version-id', buildVersion: '42' })
    );

    const promise = readAsync(graphqlClient);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('42');
    expect(graphqlClient.query).toHaveBeenCalledTimes(2);
  });

  it('fails with a user error, the reason of the server and the way out when the token cannot read the record', async () => {
    const graphqlClient = createGraphqlClient({ error: unauthorizedError });

    const promise = readAsync(graphqlClient);

    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NATIVE_BUILD_NUMBER_REQUEST_FAILED',
      message:
        'EAS could not read the build number that is stored for "dev.expo.nativeapp": [GraphQL] Entity Not Authorized\nThe build reads and stores the build number with the access token of the workflow job. Fix the cause that the server names above, or set "auto_increment: false" to build with the number of the project.',
      cause: unauthorizedError,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
  });

  it('fails with a system error when the server reports an error that is not transient', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'Unexpected',
          extensions: { errorCode: 'INTERNAL_SERVER_ERROR', isTransient: false },
        },
      ],
    });
    const graphqlClient = createGraphqlClient({ error });

    const promise = readAsync(graphqlClient);

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message:
        'EAS could not read the build number that is stored for "dev.expo.nativeapp": [GraphQL] Unexpected',
      cause: error,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
  });
});

describe(storeBuildNumberAsync, () => {
  const buildNumberToStore = {
    ...KEY,
    platform: Platform.ANDROID,
    buildNumber: '43',
    appVersion: '1.2.0',
  };

  it('creates a record of the platform with the build number and the version of the app', async () => {
    const graphqlClient = createGraphqlClient({
      data: { appVersion: { createAppVersion: { id: 'app-version-id' } } },
    });

    await storeBuildNumberAsync(graphqlClient, buildNumberToStore);

    expect(graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      appVersionInput: {
        appId: APP_ID,
        platform: 'ANDROID',
        applicationIdentifier: 'dev.expo.nativeapp',
        storeVersion: '1.2.0',
        buildVersion: '43',
      },
    });
  });

  it('fails with a user error and the number it could not store when the token cannot create the record', async () => {
    const graphqlClient = createGraphqlClient({ error: unauthorizedError });

    const promise = storeBuildNumberAsync(graphqlClient, buildNumberToStore);

    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NATIVE_BUILD_NUMBER_REQUEST_FAILED',
      message: expect.stringContaining(
        'EAS could not store the build number 43 for "dev.expo.nativeapp": [GraphQL] Entity Not Authorized'
      ),
    });
  });
});
