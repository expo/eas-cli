import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import { AppleAppIdentifierFragment } from '../../types/credentials/AppleAppIdentifier';
import { AppleDeviceFragment } from '../../types/credentials/AppleDevice';
import {
  AppleProvisioningProfile,
  AppleProvisioningProfileFragment,
} from '../../types/credentials/AppleProvisioningProfile';
import { AppleTeamFragment } from '../../types/credentials/AppleTeam';
import { IosDistributionType } from '../../types/credentials/IosAppBuildCredentials';

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
                      provisioningProfile {
                        ...${AppleProvisioningProfileFragment.name}
                        appleTeam {
                          ...${AppleTeamFragment.name}
                        }
                        appleDevices {
                          ...${AppleDeviceFragment.name}
                        }
                        appleAppIdentifier {
                          ...${AppleAppIdentifierFragment.name}
                        }
                      }
                    }
                  }
                }
              }
            }
            ${AppleProvisioningProfileFragment.definition}
            ${AppleTeamFragment.definition}
            ${AppleDeviceFragment.definition}
            ${AppleAppIdentifierFragment.definition}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
            iosDistributionType,
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
