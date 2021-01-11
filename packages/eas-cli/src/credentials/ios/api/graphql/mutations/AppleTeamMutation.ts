import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleTeam } from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleTeamMutation = {
  async createAppleTeamAsync(
    appleTeamInput: {
      appleTeamIdentifier: string;
      appleTeamName?: string;
    },
    accountId: string
  ): Promise<AppleTeam> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ appleTeam: { createAppleTeam: AppleTeam } }>(
          gql`
            mutation AppleTeamMutation($appleTeamInput: AppleTeamInput!, $accountId: ID!) {
              appleTeam {
                createAppleTeam(appleTeamInput: $appleTeamInput, accountId: $accountId) {
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
