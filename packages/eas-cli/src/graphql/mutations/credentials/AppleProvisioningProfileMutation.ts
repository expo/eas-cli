import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import {
  AppleProvisioningProfile,
  AppleProvisioningProfileFragment,
} from '../../types/credentials/AppleProvisioningProfile';
import { AppleTeamFragment } from '../../types/credentials/AppleTeam';

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
                  ...${AppleProvisioningProfileFragment.name}
                  appleTeam {
                    ...${AppleTeamFragment.name}
                  }
                }
              }
            }
            ${AppleProvisioningProfileFragment.definition}
            ${AppleTeamFragment.definition}
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
                  ...${AppleProvisioningProfileFragment.name}
                  appleTeam {
                    ...${AppleTeamFragment.name}
                  }
                }
              }
            }
            ${AppleProvisioningProfileFragment.definition}
            ${AppleTeamFragment.definition}
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
