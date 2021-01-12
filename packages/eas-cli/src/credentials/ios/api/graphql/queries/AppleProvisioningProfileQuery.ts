import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleAppIdentifierFragment,
  AppleDeviceFragment,
  AppleProvisioningProfileFragment,
  AppleProvisioningProfilesByAppQuery,
  AppleTeamFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentNode } from '../../../../../graphql/types/credentials/AppleAppIdentifier';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleProvisioningProfileFragmentNode } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleProvisioningProfileQueryResult = AppleProvisioningProfileFragment & {
  appleTeam?: AppleTeamFragment | null;
} & { appleDevices: AppleDeviceFragment[] } & { appleAppIdentifier: AppleAppIdentifierFragment };
const AppleProvisioningProfileQuery = {
  async getForAppAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<AppleProvisioningProfileQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleProvisioningProfilesByAppQuery>(
          gql`
            query AppleProvisioningProfilesByAppQuery(
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
                      provisioningProfile {
                        id
                        ...AppleProvisioningProfileFragment
                        appleTeam {
                          id
                          ...AppleTeamFragment
                        }
                        appleDevices {
                          id
                          ...AppleDeviceFragment
                        }
                        appleAppIdentifier {
                          id
                          ...AppleAppIdentifierFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppleProvisioningProfileFragmentNode)}
            ${print(AppleTeamFragmentNode)}
            ${print(AppleDeviceFragmentNode)}
            ${print(AppleAppIdentifierFragmentNode)}
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
      data.app!.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0]
        ?.provisioningProfile ?? null
    );
  },
};

export { AppleProvisioningProfileQuery };
