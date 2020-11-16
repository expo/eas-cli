import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import {
  IosAppCredentials,
  IosAppCredentialsFragment,
} from '../../types/credentials/IosAppCredentials';

const IosAppCredentialsMutation = {
  async createIosAppCredentialsAsync(
    iosAppCredentialsInput: {
      appleTeamId: string;
      pushKeyId?: string;
    },
    appId: string,
    accountId: string
  ): Promise<IosAppCredentials> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ iosAppCredentials: { createIosAppCredentials: IosAppCredentials } }>(
          gql`
            mutation IosAppCredentialsMutation($iosAppCredentialsInput: IosAppCredentialsInput!, $appId: ID!, $appleAppIdentifierId: ID!) {
              iosAppCredentials {
                createIosAppCredentials(iosAppCredentialsInput: $iosAppCredentialsInput, appId: $appId, appleAppIdentifierId: $appleAppIdentifierId) {
                  ...${IosAppCredentialsFragment.name}
                }
              }
            }
            ${IosAppCredentialsFragment.definition}
          `,
          {
            iosAppCredentialsInput,
            appId,
            accountId,
          }
        )
        .toPromise()
    );
    return data.iosAppCredentials.createIosAppCredentials;
  },
};

export { IosAppCredentialsMutation };
