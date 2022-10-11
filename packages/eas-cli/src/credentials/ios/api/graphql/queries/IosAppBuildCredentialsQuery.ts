import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

export const IosAppBuildCredentialsQuery = {
  async byAppIdentifierIdAndDistributionTypeAsync(
    graphqlClient: ExpoGraphqlClient,
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
                    iosAppBuildCredentialsList(
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
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsList[0] ?? null;
  },
};
