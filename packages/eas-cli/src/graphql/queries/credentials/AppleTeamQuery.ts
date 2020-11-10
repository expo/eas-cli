import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import { AppleTeam } from '../../types/credentials/AppleTeam';

const AppleTeamQuery = {
  async byAppleTeamIdentifierAsync(
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleTeam> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ appleTeam: { byAppleTeamIdentifier: AppleTeam } }>(
          gql`
            query($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  id
                  appleTeamIdentifier
                  appleTeamName
                }
              }
            }
          `,
          {
            accountId,
            appleTeamIdentifier,
          }
        )
        .toPromise()
    );
    return data.appleTeam.byAppleTeamIdentifier;
  },
};

export { AppleTeamQuery };
