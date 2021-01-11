import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleProvisioningProfile } from '../../../../../graphql/generated';
import { AppleProvisioningProfileFragmentNode } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleProvisioningProfileMutation = {
  async createAppleProvisioningProfileAsync(
    appleProvisioningProfileInput: {
      appleProvisioningProfile: string;
      developerPortalIdentifier?: string;
    },
    accountId: string,
    appleAppIdentifierId: string
  ): Promise<AppleProvisioningProfile> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appleProvisioningProfile: { createAppleProvisioningProfile: AppleProvisioningProfile };
        }>(
          gql`
            mutation AppleProvisioningProfileMutation(
              $appleProvisioningProfileInput: AppleProvisioningProfileInput!
              $accountId: ID!
              $appleAppIdentifierId: ID!
            ) {
              appleProvisioningProfile {
                createAppleProvisioningProfile(
                  appleProvisioningProfileInput: $appleProvisioningProfileInput
                  accountId: $accountId
                  appleAppIdentifierId: $appleAppIdentifierId
                ) {
                  id
                  ...AppleProvisioningProfileFragment
                  appleTeam {
                    id
                    ...AppleTeamFragment
                  }
                }
              }
            }
            ${print(AppleProvisioningProfileFragmentNode)}
            ${print(AppleTeamFragmentNode)}
          `,
          {
            appleProvisioningProfileInput,
            accountId,
            appleAppIdentifierId,
          }
        )
        .toPromise()
    );
    return data.appleProvisioningProfile.createAppleProvisioningProfile;
  },
  async updateAppleProvisioningProfileAsync(
    appleProvisioningProfileId: string,
    appleProvisioningProfileInput: {
      appleProvisioningProfile: string;
      developerPortalIdentifier?: string;
    }
  ): Promise<AppleProvisioningProfile> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appleProvisioningProfile: { updateAppleProvisioningProfile: AppleProvisioningProfile };
        }>(
          gql`
            mutation AppleProvisioningProfileMutation(
              $appleProvisioningProfileId: ID!
              $appleProvisioningProfileInput: AppleProvisioningProfileInput!
            ) {
              appleProvisioningProfile {
                updateAppleProvisioningProfile(
                  id: $appleProvisioningProfileId
                  appleProvisioningProfileInput: $appleProvisioningProfileInput
                ) {
                  id
                  ...AppleProvisioningProfileFragment
                  appleTeam {
                    id
                    ...AppleTeamFragment
                  }
                }
              }
            }
            ${print(AppleProvisioningProfileFragmentNode)}
            ${print(AppleTeamFragmentNode)}
          `,
          {
            appleProvisioningProfileId,
            appleProvisioningProfileInput,
          }
        )
        .toPromise()
    );
    return data.appleProvisioningProfile.updateAppleProvisioningProfile;
  },
};

export { AppleProvisioningProfileMutation };
