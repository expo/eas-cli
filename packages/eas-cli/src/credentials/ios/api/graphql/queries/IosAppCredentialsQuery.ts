import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonIosAppCredentialsFragment,
  CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery,
  IosAppBuildCredentialsFragment,
  IosAppCredentialsByAppIdentifierIdQuery,
  IosAppCredentialsFragment,
  IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';
import {
  CommonIosAppCredentialsFragmentNode,
  IosAppCredentialsFragmentNode,
} from '../../../../../graphql/types/credentials/IosAppCredentials';

export type IosAppCredentialsWithBuildCredentialsQueryResult = IosAppCredentialsFragment & {
  iosAppBuildCredentialsArray: IosAppBuildCredentialsFragment[];
};
const IosAppCredentialsQuery = {
  async byAppIdentifierIdAsync(
    projectFullName: string,
    appleAppIdentifierId: string
  ): Promise<IosAppCredentialsFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<IosAppCredentialsByAppIdentifierIdQuery>(
          gql`
            query IosAppCredentialsByAppIdentifierIdQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    ...IosAppCredentialsFragment
                  }
                }
              }
            }
            ${print(IosAppCredentialsFragmentNode)}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
          },
          {
            additionalTypenames: ['IosAppCredentials'],
          }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName.iosAppCredentials[0] ?? null;
  },
  async withBuildCredentialsByAppIdentifierIdAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: {
      appleAppIdentifierId: string;
      iosDistributionType: IosDistributionType;
    }
  ): Promise<IosAppCredentialsWithBuildCredentialsQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery>(
          gql`
            query IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    ...IosAppCredentialsFragment
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
            ${print(IosAppCredentialsFragmentNode)}
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

export { IosAppCredentialsQuery };
