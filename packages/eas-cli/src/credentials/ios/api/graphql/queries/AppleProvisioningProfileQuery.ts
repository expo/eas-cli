import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleProvisioningProfile, IosDistributionType } from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentDoc } from '../../../../../graphql/types/credentials/AppleAppIdentifier';
import { AppleDeviceFragmentDoc } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleProvisioningProfileFragmentDoc } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragmentDoc } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleProvisioningProfileQuery = {
  async getForAppAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<AppleProvisioningProfile | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          app: {
            byFullName: {
              iosAppCredentials: {
                iosAppBuildCredentialsArray: {
                  provisioningProfile?: AppleProvisioningProfile;
                }[];
              }[];
            };
          };
        }>(
          gql`
            query AppleProvisioningProfilesByAppQuery(
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
                      provisioningProfile {
                        ...AppleProvisioningProfileFragment
                        appleTeam {
                          ...AppleTeamFragment
                        }
                        appleDevices {
                          ...AppleDeviceFragment
                        }
                        appleAppIdentifier {
                          ...AppleAppIdentifierFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppleProvisioningProfileFragmentDoc)}
            ${print(AppleTeamFragmentDoc)}
            ${print(AppleDeviceFragmentDoc)}
            ${print(AppleAppIdentifierFragmentDoc)}
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
    return (
      data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0]
        ?.provisioningProfile ?? null
    );
  },
};

export { AppleProvisioningProfileQuery };
