import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  CreateAppleProvisioningProfileMutation,
  UpdateAppleProvisioningProfileMutation,
} from '../../../../../graphql/generated';
import { AppleProvisioningProfileFragmentNode } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleProvisioningProfileMutationResult = AppleProvisioningProfileFragment & {
  appleTeam?: AppleTeamFragment | null;
};

const AppleProvisioningProfileMutation = {
  async createAppleProvisioningProfileAsync(
    appleProvisioningProfileInput: {
      appleProvisioningProfile: string;
      developerPortalIdentifier?: string;
    },
    accountId: string,
    appleAppIdentifierId: string
  ): Promise<AppleProvisioningProfileMutationResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleProvisioningProfileMutation>(
          gql`
            mutation CreateAppleProvisioningProfileMutation(
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
  ): Promise<AppleProvisioningProfileMutationResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateAppleProvisioningProfileMutation>(
          gql`
            mutation UpdateAppleProvisioningProfileMutation(
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
  async deleteAppleProvisioningProfilesAsync(appleProvisioningProfileIds: string[]): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateAppleProvisioningProfileMutation>(
          gql`
            mutation DeleteAppleProvisioningProfilesMutation($appleProvisioningProfileIds: [ID!]!) {
              appleProvisioningProfile {
                deleteAppleProvisioningProfiles(ids: $appleProvisioningProfileIds) {
                  id
                }
              }
            }
          `,
          {
            appleProvisioningProfileIds,
          }
        )
        .toPromise()
    );
  },
};

export { AppleProvisioningProfileMutation };
