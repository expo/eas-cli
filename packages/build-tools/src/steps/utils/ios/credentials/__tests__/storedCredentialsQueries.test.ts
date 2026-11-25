import { SystemError, UserError } from '@expo/eas-build-job';
import { Client, CombinedError, stringifyDocument } from '@urql/core';

import {
  readStoredIosAppCredentialsAsync,
  readStoredIosBuildCredentialsAsync,
} from '../storedCredentialsQueries';

const APP_ID = 'app-id';

function createGraphqlClient(...results: object[]): Client {
  const toPromise = jest.fn();
  for (const result of results) {
    toPromise.mockResolvedValueOnce(result);
  }
  return { query: jest.fn(() => ({ toPromise })) } as unknown as Client;
}

function buildCredentialsResult(iosAppBuildCredentials: object | undefined): object {
  return {
    data: {
      app: {
        byId: {
          id: APP_ID,
          iosAppCredentials: [
            {
              id: 'ios-app-credentials-id',
              iosAppBuildCredentialsList: iosAppBuildCredentials ? [iosAppBuildCredentials] : [],
            },
          ],
        },
      },
    },
  };
}

const BUILD_CREDENTIALS_VARIABLES = {
  appId: APP_ID,
  appleAppIdentifierId: 'app-identifier-id',
  iosDistributionType: 'AD_HOC',
} as const;

afterEach(() => {
  jest.useRealTimers();
});

describe(readStoredIosAppCredentialsAsync, () => {
  it('returns each bundle identifier of the app with the distribution types that are stored for it', async () => {
    const graphqlClient = createGraphqlClient({
      data: {
        app: {
          byId: {
            id: APP_ID,
            iosAppCredentials: [
              {
                id: 'ios-app-credentials-id',
                appleAppIdentifier: {
                  id: 'app-identifier-id',
                  bundleIdentifier: 'dev.expo.nativeapp',
                },
                iosAppBuildCredentialsList: [
                  { id: 'app-store-id', iosDistributionType: 'APP_STORE' },
                  { id: 'ad-hoc-id', iosDistributionType: 'AD_HOC' },
                ],
              },
              {
                id: 'widget-ios-app-credentials-id',
                appleAppIdentifier: {
                  id: 'widget-identifier-id',
                  bundleIdentifier: 'dev.expo.nativeapp.widget',
                },
                iosAppBuildCredentialsList: [],
              },
            ],
          },
        },
      },
    });

    await expect(
      readStoredIosAppCredentialsAsync(graphqlClient, { appId: APP_ID })
    ).resolves.toEqual([
      {
        appleAppIdentifierId: 'app-identifier-id',
        bundleIdentifier: 'dev.expo.nativeapp',
        iosDistributionTypes: ['APP_STORE', 'AD_HOC'],
      },
      {
        appleAppIdentifierId: 'widget-identifier-id',
        bundleIdentifier: 'dev.expo.nativeapp.widget',
        iosDistributionTypes: [],
      },
    ]);
    expect(graphqlClient.query).toHaveBeenCalledWith(expect.anything(), { appId: APP_ID });
  });

  it('fails with a user error and the reason of the server when the token cannot read the credentials', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        {
          message:
            'Entity Not Authorized: Reading this credential requires the Release Manager role or higher since credentials protection is on for the account.',
          extensions: { errorCode: 'UNAUTHORIZED_ERROR', isTransient: false },
        },
      ],
    });
    const graphqlClient = createGraphqlClient({ error });

    const promise = readStoredIosAppCredentialsAsync(graphqlClient, { appId: APP_ID });

    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NATIVE_IOS_CREDENTIALS_READ_FAILED',
      message:
        'EAS could not read the credentials that are stored for the project: [GraphQL] Entity Not Authorized: Reading this credential requires the Release Manager role or higher since credentials protection is on for the account.\nThe build reads the credentials with the access token of the workflow job. Fix the cause that the server names above, then run the build again.',
      cause: error,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
  });

  it('fails with a system error, and does not read again, when the server reports an error that is not transient', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'Unexpected',
          extensions: { errorCode: 'INTERNAL_SERVER_ERROR', isTransient: false },
        },
      ],
    });
    const graphqlClient = createGraphqlClient({ error });

    const promise = readStoredIosAppCredentialsAsync(graphqlClient, { appId: APP_ID });

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message:
        'EAS could not read the credentials that are stored for the project: [GraphQL] Unexpected',
      cause: error,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
  });

  it('reads again after a failure of the network', async () => {
    jest.useFakeTimers();
    const data = { app: { byId: { id: APP_ID, iosAppCredentials: [] } } };
    const graphqlClient = createGraphqlClient(
      { error: new CombinedError({ networkError: new TypeError('fetch failed') }) },
      { data }
    );

    const promise = readStoredIosAppCredentialsAsync(graphqlClient, { appId: APP_ID });
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toEqual([]);
    expect(graphqlClient.query).toHaveBeenCalledTimes(2);
  });

  it('fails with a system error when the server keeps failing', async () => {
    jest.useFakeTimers();
    const error = new CombinedError({
      graphQLErrors: [{ message: 'Internal Server Error' }],
      response: { status: 500 },
    });
    const attemptsBeforeGivingUp = 6;
    const graphqlClient = createGraphqlClient(
      ...Array.from({ length: attemptsBeforeGivingUp }, () => ({ error }))
    );

    const promise = readStoredIosAppCredentialsAsync(graphqlClient, { appId: APP_ID });
    const rejection = expect(promise).rejects.toBeInstanceOf(SystemError);
    await jest.runAllTimersAsync();

    await rejection;
    await expect(promise).rejects.toMatchObject({
      message:
        'EAS could not read the credentials that are stored for the project: [GraphQL] Internal Server Error',
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(attemptsBeforeGivingUp);
  });
});

describe(readStoredIosBuildCredentialsAsync, () => {
  it('returns the distribution certificate and the provisioning profile of the distribution type', async () => {
    const graphqlClient = createGraphqlClient(
      buildCredentialsResult({
        id: 'ad-hoc-id',
        distributionCertificate: {
          id: 'certificate-id',
          certificateP12: 'Y2VydGlmaWNhdGU=',
          certificatePassword: 'password',
          validityNotBefore: '2026-01-01T00:00:00.000Z',
          validityNotAfter: '2027-01-01T00:00:00.000Z',
        },
        provisioningProfile: { id: 'profile-id', provisioningProfile: 'cHJvZmlsZQ==' },
      })
    );

    await expect(
      readStoredIosBuildCredentialsAsync(graphqlClient, BUILD_CREDENTIALS_VARIABLES)
    ).resolves.toEqual({
      distributionCertificate: {
        dataBase64: 'Y2VydGlmaWNhdGU=',
        password: 'password',
        validityNotBefore: new Date('2026-01-01T00:00:00.000Z'),
        validityNotAfter: new Date('2027-01-01T00:00:00.000Z'),
      },
      provisioningProfileBase64: 'cHJvZmlsZQ==',
    });
    const [query, variables] = jest.mocked(graphqlClient.query).mock.calls[0];
    expect(variables).toEqual(BUILD_CREDENTIALS_VARIABLES);
    const queryText = stringifyDocument(query);
    expect(queryText).toContain(
      'iosAppCredentials(filter: {appleAppIdentifierId: $appleAppIdentifierId})'
    );
    expect(queryText).toContain(
      'iosAppBuildCredentialsList(filter: {iosDistributionType: $iosDistributionType})'
    );
  });

  it('returns a record without a distribution certificate and a provisioning profile', async () => {
    const graphqlClient = createGraphqlClient(
      buildCredentialsResult({
        id: 'ad-hoc-id',
        distributionCertificate: null,
        provisioningProfile: null,
      })
    );

    await expect(
      readStoredIosBuildCredentialsAsync(graphqlClient, BUILD_CREDENTIALS_VARIABLES)
    ).resolves.toEqual({ distributionCertificate: null, provisioningProfileBase64: null });
  });

  it('returns no distribution certificate and no provisioning profile when no record of the distribution type is stored', async () => {
    const graphqlClient = createGraphqlClient(buildCredentialsResult(undefined));

    await expect(
      readStoredIosBuildCredentialsAsync(graphqlClient, BUILD_CREDENTIALS_VARIABLES)
    ).resolves.toEqual({ distributionCertificate: null, provisioningProfileBase64: null });
  });
});
