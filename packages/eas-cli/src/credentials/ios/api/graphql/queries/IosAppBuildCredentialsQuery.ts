import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

const IosAppBuildCredentialsQuery = {
  async byAppIdentifierIdAndDistributionTypeAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<IosAppBuildCredentialsFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery>(
          gql`
            query IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    iosAppBuildCredentialsArray(
                      filter: { iosDistributionType: $iosDistributionType }
                    ) {
                      id
                      ...IosAppBuildCredentialsFragment
                    }
                  }
                }
              }
            }
            ${print(IosAppBuildCredentialsFragmentNode)}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
            iosDistributionType,
          },
          {
            additionalTypenames: ['IosAppCredentials', 'IosAppBuildCredentials'],
          }
        )
        .toPromise()
    );
    return data.app!.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0] ?? null;
  },
};

export { IosAppBuildCredentialsQuery };
