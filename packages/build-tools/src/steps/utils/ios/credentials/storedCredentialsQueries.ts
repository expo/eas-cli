import { SystemError, UserError } from '@expo/eas-build-job';
import { Client, OperationResult } from '@urql/core';
import { graphql } from 'gql.tada';
import { z } from 'zod';

import { describeError, findGraphqlErrorCode } from '../../../../utils/networkErrors';
import { requestGraphqlDataWithRetriesAsync } from '../../../../utils/retryOnNetworkFailure';

const IOS_APP_CREDENTIALS_QUERY = graphql(`
  query NativeBuildIosAppCredentialsQuery($appId: String!) {
    app {
      byId(appId: $appId) {
        id
        iosAppCredentials {
          id
          appleAppIdentifier {
            id
            bundleIdentifier
          }
          iosAppBuildCredentialsList {
            id
            iosDistributionType
          }
        }
      }
    }
  }
`);

const IOS_BUILD_CREDENTIALS_QUERY = graphql(`
  query NativeBuildIosBuildCredentialsQuery(
    $appId: String!
    $appleAppIdentifierId: String!
    $iosDistributionType: IosDistributionType!
  ) {
    app {
      byId(appId: $appId) {
        id
        iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
          id
          iosAppBuildCredentialsList(filter: { iosDistributionType: $iosDistributionType }) {
            id
            distributionCertificate {
              id
              certificateP12
              certificatePassword
              validityNotBefore
              validityNotAfter
            }
            provisioningProfile {
              id
              provisioningProfile
            }
          }
        }
      }
    }
  }
`);

export type IosDistributionType = 'APP_STORE' | 'AD_HOC' | 'ENTERPRISE' | 'DEVELOPMENT';

export interface StoredIosAppCredentials {
  appleAppIdentifierId: string;
  bundleIdentifier: string;
  iosDistributionTypes: IosDistributionType[];
}

export interface StoredIosBuildCredentials {
  distributionCertificate: {
    dataBase64: string | null;
    password: string | null;
    validityNotBefore: Date;
    validityNotAfter: Date;
  } | null;
  provisioningProfileBase64: string | null;
}

export async function readStoredIosAppCredentialsAsync(
  graphqlClient: Client,
  { appId }: { appId: string }
): Promise<StoredIosAppCredentials[]> {
  const data = await queryStoredCredentialsAsync(() =>
    graphqlClient.query(IOS_APP_CREDENTIALS_QUERY, { appId }).toPromise()
  );
  const iosAppCredentialsList: {
    appleAppIdentifier: { id: string; bundleIdentifier: string };
    iosAppBuildCredentialsList: { iosDistributionType: IosDistributionType }[];
  }[] = data.app.byId.iosAppCredentials;
  return iosAppCredentialsList.map(({ appleAppIdentifier, iosAppBuildCredentialsList }) => ({
    appleAppIdentifierId: appleAppIdentifier.id,
    bundleIdentifier: appleAppIdentifier.bundleIdentifier,
    iosDistributionTypes: iosAppBuildCredentialsList.map(
      ({ iosDistributionType }) => iosDistributionType
    ),
  }));
}

export async function readStoredIosBuildCredentialsAsync(
  graphqlClient: Client,
  variables: {
    appId: string;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
  }
): Promise<StoredIosBuildCredentials> {
  const data = await queryStoredCredentialsAsync(() =>
    graphqlClient.query(IOS_BUILD_CREDENTIALS_QUERY, variables).toPromise()
  );
  const buildCredentials = data.app.byId.iosAppCredentials.at(0)?.iosAppBuildCredentialsList.at(0);
  const distributionCertificate = buildCredentials?.distributionCertificate;
  return {
    distributionCertificate: distributionCertificate
      ? {
          dataBase64: distributionCertificate.certificateP12,
          password: distributionCertificate.certificatePassword,
          validityNotBefore: z.coerce.date().parse(distributionCertificate.validityNotBefore),
          validityNotAfter: z.coerce.date().parse(distributionCertificate.validityNotAfter),
        }
      : null,
    provisioningProfileBase64: buildCredentials?.provisioningProfile?.provisioningProfile ?? null,
  };
}

async function queryStoredCredentialsAsync<TData>(
  queryAsync: () => Promise<OperationResult<TData>>
): Promise<TData> {
  try {
    return await requestGraphqlDataWithRetriesAsync(queryAsync, {
      operation: 'native_build.stored_credentials',
    });
  } catch (error) {
    const message = `EAS could not read the credentials that are stored for the project: ${describeError(error)}`;
    throw findGraphqlErrorCode(error) === 'UNAUTHORIZED_ERROR'
      ? new UserError(
          'NATIVE_IOS_CREDENTIALS_READ_FAILED',
          `${message}\nThe build reads the credentials with the access token of the workflow job. Fix the cause that the server names above, then run the build again.`,
          { cause: error }
        )
      : new SystemError(message, { cause: error });
  }
}
