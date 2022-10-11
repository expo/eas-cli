import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleProvisioningProfileFragment,
  AppleProvisioningProfileInput,
  AppleTeamFragment,
  CreateAppleProvisioningProfileMutation,
  UpdateAppleProvisioningProfileMutation,
} from '../../../../../graphql/generated';
import { AppleProvisioningProfileFragmentNode } from '../../../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleProvisioningProfileMutationResult = AppleProvisioningProfileFragment & {
  appleTeam?: AppleTeamFragment | null;
};

export const AppleProvisioningProfileMutation = {
  async createAppleProvisioningProfileAsync(
    graphqlClient: ExpoGraphqlClient,
    appleProvisioningProfileInput: AppleProvisioningProfileInput,
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
    graphqlClient: ExpoGraphqlClient,
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
  async deleteAppleProvisioningProfilesAsync(
    graphqlClient: ExpoGraphqlClient,
    appleProvisioningProfileIds: string[]
  ): Promise<void> {
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
          },
          {
            additionalTypenames: ['AppleProvisioningProfile', 'IosAppBuildCredentials'],
          }
        )
        .toPromise()
    );
  },
};
