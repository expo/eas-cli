import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppCredentials, IosDistributionType } from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentDoc } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';
import { IosAppCredentialsFragmentDoc } from '../../../../../graphql/types/credentials/IosAppCredentials';

const IosAppCredentialsQuery = {
  async byAppIdentifierIdAsync(
    projectFullName: string,
    appleAppIdentifierId: string
  ): Promise<IosAppCredentials | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ app: { byFullName: { iosAppCredentials: IosAppCredentials[] } } }>(
          gql`
            query($projectFullName: String!, $appleAppIdentifierId: String!) {
              app {
                byFullName(fullName: $projectFullName) {
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    ...IosAppCredentialsFragment
                  }
                }
              }
            }
            ${print(IosAppCredentialsFragmentDoc)}
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
  ): Promise<IosAppCredentials | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ app: { byFullName: { iosAppCredentials: IosAppCredentials[] } } }>(
          gql`
            query(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    ...IosAppCredentialsFragment
                    iosAppBuildCredentialsArray(
                      filter: { iosDistributionType: $iosDistributionType }
                    ) {
                      ...IosAppBuildCredentialsFragment
                    }
                  }
                }
              }
            }
            ${print(IosAppCredentialsFragmentDoc)}
            ${print(IosAppBuildCredentialsFragmentDoc)}
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
    return data.app.byFullName.iosAppCredentials[0] ?? null;
  },
};

export { IosAppCredentialsQuery };
