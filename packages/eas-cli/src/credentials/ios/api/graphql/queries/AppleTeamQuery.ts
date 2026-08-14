import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleTeamByIdentifierQuery,
  AppleTeamFragment,
  AppleTeamsByAccountNameQuery,
  AppleTeamsByAccountNameQueryVariables,
} from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export const AppleTeamQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    { accountName, offset, limit }: AppleTeamsByAccountNameQueryVariables
  ): Promise<AppleTeamFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleTeamsByAccountNameQuery>(
          gql`
            query AppleTeamsByAccountName($accountName: String!, $offset: Int, $limit: Int) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleTeams(offset: $offset, limit: $limit) {
                    id
                    ...AppleTeamFragment
                  }
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
          `,
          { accountName, offset, limit },
          {
            additionalTypenames: ['AppleTeam'],
          }
        )
        .toPromise()
    );

    return data.account.byName.appleTeams ?? [];
  },
  async getByAppleTeamIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
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
