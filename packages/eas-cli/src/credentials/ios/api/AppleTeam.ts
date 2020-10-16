import assert from 'assert';
import gql from 'graphql-tag';

import { graphqlClient } from '../../../api';
import { Account } from '../../../user/Account';

export interface AppleTeam {
  id: string;
  account: Account;
  appleTeamIdentifier: string;
  appleTeamName: string;
}

export async function findAppleTeamAsync({
  accountId,
  appleTeamIdentifier,
}: {
  accountId: string;
  appleTeamIdentifier: string;
}): Promise<AppleTeam> {
  const result = await graphqlClient
    .query(
      gql`
        query($accountId: ID!, $appleTeamIdentifier: String!) {
          appleTeam {
            byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
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
        accountId,
        appleTeamIdentifier,
      }
    )
    .toPromise();
  const { data, error } = result;
  if (error?.graphQLErrors) {
    const err = error?.graphQLErrors[0];
    throw err;
  }
  const appleTeam = data?.appleTeam?.byAppleTeamIdentifier;
  assert(appleTeam, `Failed to fetch Apple Team with identifier = ${appleTeamIdentifier}`);
  return appleTeam;
}
