import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppCredentials, IosDistributionType } from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragment } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';
import { IosAppCredentialsFragment } from '../../../../../graphql/types/credentials/IosAppCredentials';

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
                    ...${IosAppCredentialsFragment.name}
                  }
                }
              }
            }
            ${IosAppCredentialsFragment.definition}
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
              query($projectFullName: String!, $appleAppIdentifierId: String!, $iosDistributionType: IosDistributionType!) {
                app {
                  byFullName(fullName: $projectFullName) {
                    iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                      ...${IosAppCredentialsFragment.name}
                      iosAppBuildCredentialsArray(
                        filter: { iosDistributionType: $iosDistributionType }
                      ) {
                        ...${IosAppBuildCredentialsFragment.name}
                      }
                    }
                  }
                }
              }
              ${IosAppCredentialsFragment.definition}
              ${IosAppBuildCredentialsFragment.definition}
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
