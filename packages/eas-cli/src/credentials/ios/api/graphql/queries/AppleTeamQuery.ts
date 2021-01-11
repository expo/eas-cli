import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleTeam } from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

type AppleTeamQueryResult = Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>;

const AppleTeamQuery = {
  async getAllForAccountAsync(accountName: string): Promise<AppleTeamQueryResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { appleTeams: AppleTeamQueryResult[] } } }>(
          gql`
            query AppleTeamsByAccountName($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  appleTeams {
                    id
                    appleTeamName
                    appleTeamIdentifier
                  }
                }
              }
            }
          `,
          { accountName }
        )
        .toPromise()
    );

    return data.account.byName.appleTeams;
  },

  async getByAppleTeamIdentifierAsync(
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleTeam | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ appleTeam: { byAppleTeamIdentifier: AppleTeam | null } }>(
          gql`
            query AppleTeamByIdentifierQuery($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  ...AppleTeamFragment
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
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
