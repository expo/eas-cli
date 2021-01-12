import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  IosAppBuildCredentialsFragment,
  IosAppCredentials,
  IosAppCredentialsFragment,
  IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';
import { IosAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppCredentials';

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
        .query<{ app: { byFullName: { iosAppCredentials: IosAppCredentials[] } } }>(
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
};

export { IosAppCredentialsQuery };
