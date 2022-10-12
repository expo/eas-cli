import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
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
export const AppleProvisioningProfileQuery = {
  async getForAppAsync(
    graphqlClient: ExpoGraphqlClient,
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
                    iosAppBuildCredentialsList(
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
            additionalTypenames: [
              'AppleProvisioningProfile',
              'IosAppCredentials',
              'IosAppBuildCredentials',
            ],
          }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return (
      data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsList[0]
        ?.provisioningProfile ?? null
    );
  },
};
