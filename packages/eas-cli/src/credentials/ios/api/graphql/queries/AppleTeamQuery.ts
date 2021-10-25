import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleTeamByIdentifierQuery,
  AppleTeamFragment,
  AppleTeamsByAccountNameQuery,
} from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export const AppleTeamQuery = {
  async getAllForAccountAsync(accountName: string): Promise<AppleTeamFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleTeamsByAccountNameQuery>(
          gql`
            query AppleTeamsByAccountName($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleTeams {
                    id
                    appleTeamName
                    appleTeamIdentifier
                  }
                }
              }
            }
          `,
          { accountName },
          {
            additionalTypenames: ['AppleTeam'],
          }
        )
        .toPromise()
    );

    return data.account.byName.appleTeams;
  },

  async getByAppleTeamIdentifierAsync(
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleTeamFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleTeamByIdentifierQuery>(
          gql`
            query AppleTeamByIdentifierQuery($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  id
                  ...AppleTeamFragment
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
          `,
          {
            accountId,
            appleTeamIdentifier,
          },
          {
            additionalTypenames: ['AppleTeam'],
          }
        )
        .toPromise()
    );
    return data.appleTeam.byAppleTeamIdentifier ?? null;
  },
};
