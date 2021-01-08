import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppBuildCredentials, IosDistributionType } from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragment } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

const IosAppBuildCredentialsQuery = {
  async byAppIdentifierIdAndDistributionTypeAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<IosAppBuildCredentials | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          app: {
            byFullName: {
              iosAppCredentials: {
                iosAppBuildCredentialsArray: IosAppBuildCredentials[];
              }[];
            };
          };
        }>(
          gql`
          query(
            $projectFullName: String!
            $appleAppIdentifierId: String!
            $iosDistributionType: IosDistributionType!
          ) {
              app {
                byFullName(fullName: $projectFullName) {
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    iosAppBuildCredentialsArray(
                      filter: { iosDistributionType: $iosDistributionType }
                    ) {
                      ...${IosAppBuildCredentialsFragment.name}
                    }
                  }
                }
              }
            }
            ${print(IosAppBuildCredentialsFragment.definition)}
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
    return data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0] ?? null;
  },
};

export { IosAppBuildCredentialsQuery };
