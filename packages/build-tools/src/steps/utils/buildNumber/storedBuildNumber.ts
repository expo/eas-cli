import { Platform, SystemError, UserError } from '@expo/eas-build-job';
import { Client, OperationResult } from '@urql/core';
import { graphql } from 'gql.tada';

import { describeError, findGraphqlErrorCode } from '../../../utils/networkErrors';
import { requestGraphqlDataWithRetriesAsync } from '../../../utils/retryOnNetworkFailure';

const LATEST_APP_VERSION_QUERY = graphql(`
  query NativeBuildLatestAppVersionQuery(
    $appId: String!
    $platform: AppPlatform!
    $applicationIdentifier: String!
  ) {
    app {
      byId(appId: $appId) {
        id
        latestAppVersionByPlatformAndApplicationIdentifier(
          platform: $platform
          applicationIdentifier: $applicationIdentifier
        ) {
          id
          buildVersion
        }
      }
    }
  }
`);

const CREATE_APP_VERSION_MUTATION = graphql(`
  mutation NativeBuildCreateAppVersionMutation($appVersionInput: AppVersionInput!) {
    appVersion {
      createAppVersion(appVersionInput: $appVersionInput) {
        id
      }
    }
  }
`);

const APP_PLATFORM: Record<Platform, 'IOS' | 'ANDROID'> = {
  [Platform.IOS]: 'IOS',
  [Platform.ANDROID]: 'ANDROID',
};

export interface StoredBuildNumberKey {
  appId: string;
  platform: Platform;
  applicationIdentifier: string;
}

export async function readStoredBuildNumberAsync(
  graphqlClient: Client,
  key: StoredBuildNumberKey
): Promise<string | undefined> {
  const data = await requestAsync(
    () =>
      graphqlClient
        .query(LATEST_APP_VERSION_QUERY, { ...key, platform: APP_PLATFORM[key.platform] })
        .toPromise(),
    {
      operation: 'native_build.read_build_number',
      action: `read the build number that is stored for "${key.applicationIdentifier}"`,
    }
  );
  return (
    data.app.byId.latestAppVersionByPlatformAndApplicationIdentifier?.buildVersion ?? undefined
  );
}

export async function storeBuildNumberAsync(
  graphqlClient: Client,
  {
    buildNumber,
    appVersion,
    ...key
  }: StoredBuildNumberKey & { buildNumber: string; appVersion: string }
): Promise<void> {
  await requestAsync(
    () =>
      graphqlClient
        .mutation(CREATE_APP_VERSION_MUTATION, {
          appVersionInput: {
            ...key,
            platform: APP_PLATFORM[key.platform],
            storeVersion: appVersion,
            buildVersion: buildNumber,
          },
        })
        .toPromise(),
    {
      operation: 'native_build.store_build_number',
      action: `store the build number ${buildNumber} for "${key.applicationIdentifier}"`,
    }
  );
}

async function requestAsync<TData>(
  attemptAsync: () => Promise<OperationResult<TData>>,
  { operation, action }: { operation: string; action: string }
): Promise<TData> {
  try {
    return await requestGraphqlDataWithRetriesAsync(attemptAsync, { operation });
  } catch (error) {
    const message = `EAS could not ${action}: ${describeError(error)}`;
    throw findGraphqlErrorCode(error) === 'UNAUTHORIZED_ERROR'
      ? new UserError(
          'NATIVE_BUILD_NUMBER_REQUEST_FAILED',
          `${message}\nThe build reads and stores the build number with the access token of the workflow job. Fix the cause that the server names above, or set "auto_increment: false" to build with the number of the project.`,
          { cause: error }
        )
      : new SystemError(message, { cause: error });
  }
}
