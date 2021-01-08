import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleProvisioningProfile } from '../../../../../graphql/generated';
import { AppleProvisioningProfileFragment } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

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
            ${print(AppleProvisioningProfileFragment.definition)}
            ${print(AppleTeamFragment.definition)}
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
            ${print(AppleProvisioningProfileFragment.definition)}
            ${print(AppleTeamFragment.definition)}
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
