import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleTeamFragment,
  AppleTeamInput,
  AppleTeamUpdateInput,
  CreateAppleTeamMutation,
  CreateAppleTeamMutationVariables,
  UpdateAppleTeamMutation,
  UpdateAppleTeamMutationVariables,
} from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export const AppleTeamMutation = {
  async createAppleTeamAsync(
    graphqlClient: ExpoGraphqlClient,
    appleTeamInput: AppleTeamInput,
    accountId: string
  ): Promise<AppleTeamFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleTeamMutation, CreateAppleTeamMutationVariables>(
          gql`
            mutation CreateAppleTeamMutation($appleTeamInput: AppleTeamInput!, $accountId: ID!) {
              appleTeam {
                createAppleTeam(appleTeamInput: $appleTeamInput, accountId: $accountId) {
                  id
                  ...AppleTeamFragment
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
          `,
          {
            appleTeamInput,
            accountId,
          }
        )
        .toPromise()
    );
    return data.appleTeam.createAppleTeam;
  },
  async updateAppleTeamAsync(
    graphqlClient: ExpoGraphqlClient,
    appleTeamInput: AppleTeamUpdateInput,
    appleTeamEntityId: string
  ): Promise<AppleTeamFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateAppleTeamMutation, UpdateAppleTeamMutationVariables>(
          gql`
            mutation UpdateAppleTeamMutation(
              $appleTeamInput: AppleTeamUpdateInput!
              $appleTeamEntityId: ID!
            ) {
              appleTeam {
                updateAppleTeam(appleTeamUpdateInput: $appleTeamInput, id: $appleTeamEntityId) {
                  id
                  ...AppleTeamFragment
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
          `,
          {
            appleTeamInput,
            appleTeamEntityId,
          }
        )
        .toPromise()
    );
    return data.appleTeam.updateAppleTeam;
  },
};
