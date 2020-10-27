import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import { AppleTeam } from '../../types/credentials/AppleTeam';

export class AppleTeamMutation {
  static async createAppleTeamAsync(
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
                  id
                  account {
                    id
                    name
                  }
                  appleTeamIdentifier
                  appleTeamName
                }
              }
            }
          `,
          {
            appleTeamInput,
            accountId,
          }
        )
        .toPromise()
    );
    return data.appleTeam.createAppleTeam;
  }
}
