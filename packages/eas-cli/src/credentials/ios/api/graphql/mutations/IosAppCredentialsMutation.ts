import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppCredentials } from '../../../../../graphql/generated';
import { IosAppCredentialsFragment } from '../../../../../graphql/types/credentials/IosAppCredentials';

const IosAppCredentialsMutation = {
  async createIosAppCredentialsAsync(
    iosAppCredentialsInput: {
      appleTeamId: string;
      pushKeyId?: string;
    },
    appId: string,
    appleAppIdentifierId: string
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
            appleAppIdentifierId,
          }
        )
        .toPromise()
    );
    return data.iosAppCredentials.createIosAppCredentials;
  },
};

export { IosAppCredentialsMutation };
