import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonIosAppCredentialsFragment,
  CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery,
  IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';
import {
  CommonIosAppCredentialsFragmentNode,
  CommonIosAppCredentialsWithoutBuildCredentialsFragmentNode,
} from '../../../../../graphql/types/credentials/IosAppCredentials';

export const IosAppCredentialsQuery = {
  async withBuildCredentialsByAppIdentifierIdAsync(
    graphqlClient: ExpoGraphqlClient,
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: {
      appleAppIdentifierId: string;
      iosDistributionType?: IosDistributionType;
    }
  ): Promise<CommonIosAppCredentialsFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery>(
          gql`
            query IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    ...CommonIosAppCredentialsWithoutBuildCredentialsFragment
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
            ${print(CommonIosAppCredentialsWithoutBuildCredentialsFragmentNode)}
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
    return data.app.byFullName.iosAppCredentials[0] ?? null;
  },
  async withCommonFieldsByAppIdentifierIdAsync(
    graphqlClient: ExpoGraphqlClient,
    projectFullName: string,
    {
      appleAppIdentifierId,
    }: {
      appleAppIdentifierId: string;
    }
  ): Promise<CommonIosAppCredentialsFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery>(
          gql`
            query CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    ...CommonIosAppCredentialsFragment
                  }
                }
              }
            }
            ${CommonIosAppCredentialsFragmentNode}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
          },
          {
            additionalTypenames: ['IosAppCredentials', 'IosAppBuildCredentials', 'App'],
          }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName.iosAppCredentials[0] ?? null;
  },
};
