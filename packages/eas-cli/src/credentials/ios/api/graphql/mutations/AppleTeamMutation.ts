import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AccountFragment,
  AppleTeamFragment,
  AppleTeamInput,
  CreateAppleTeamMutation,
} from '../../../../../graphql/generated';
import { AccountFragmentNode } from '../../../../../graphql/types/Account';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleTeamMutationResult = AppleTeamFragment & {
  account: AccountFragment;
};

export const AppleTeamMutation = {
  async createAppleTeamAsync(
    graphqlClient: ExpoGraphqlClient,
    appleTeamInput: AppleTeamInput,
    accountId: string
  ): Promise<AppleTeamMutationResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleTeamMutation>(
          gql`
            mutation CreateAppleTeamMutation($appleTeamInput: AppleTeamInput!, $accountId: ID!) {
              appleTeam {
                createAppleTeam(appleTeamInput: $appleTeamInput, accountId: $accountId) {
                  id
                  ...AppleTeamFragment
                  account {
                    id
                    ...AccountFragment
                  }
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
            ${print(AccountFragmentNode)}
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
};
