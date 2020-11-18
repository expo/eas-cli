import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleTeam, AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleTeamQuery = {
  async byAppleTeamIdentifierAsync(
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleTeam | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ appleTeam: { byAppleTeamIdentifier: AppleTeam | null } }>(
          gql`
            query($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  ...${AppleTeamFragment.name}
                }
              }
            }
            ${AppleTeamFragment.definition}
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
