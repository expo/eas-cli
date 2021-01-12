import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleTeamFragment, CreateAppleTeamMutation } from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';
import { Account } from '../../../../../user/Account';

export type AppleTeamMutationResult = AppleTeamFragment & {
  account: Account;
};

const AppleTeamMutation = {
  async createAppleTeamAsync(
    appleTeamInput: {
      appleTeamIdentifier: string;
      appleTeamName?: string;
    },
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
                    name
                  }
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
};

export { AppleTeamMutation };
