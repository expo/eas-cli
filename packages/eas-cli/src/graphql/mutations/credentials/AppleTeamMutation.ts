import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import { AppleTeam, AppleTeamFragment } from '../../types/credentials/AppleTeam';

const AppleTeamMutation = {
  async createAppleTeamAsync(
    appleTeamInput: {
      appleTeamIdentifier: string;
      appleTeamName: string;
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
                  ...${AppleTeamFragment.name}
                  account {
                    id
                    name
                  }
                }
              }
            }
            ${AppleTeamFragment.definition}
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
