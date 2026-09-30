import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountFragment,
  CurrentUserQuery,
  CurrentUserWithPrimaryAccountQuery,
} from '../generated';
import { AccountFragmentNode } from '../types/Account';
import { MeActorFragmentNode } from '../types/Actor';

export const UserQuery = {
  async currentUserAsync(graphqlClient: ExpoGraphqlClient): Promise<CurrentUserQuery['meActor']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<CurrentUserQuery>(
          gql`
            query CurrentUser {
              meActor {
                __typename
                id
                ...MeActorFragment
              }
            }
            ${print(MeActorFragmentNode)}
          `,
          {},
          {
            additionalTypenames: ['User', 'SSOUser'],
          }
        )
        .toPromise()
    );

    return data.meActor;
  },
  async requireCurrentUserPrimaryAccountAsync(
    graphqlClient: ExpoGraphqlClient
  ): Promise<AccountFragment> {
    let data: CurrentUserWithPrimaryAccountQuery;
    try {
      data = await withErrorHandlingAsync(
        graphqlClient
          .query<CurrentUserWithPrimaryAccountQuery>(
            gql`
              query CurrentUserWithPrimaryAccount {
                meActor {
                  __typename
                  id
                  ... on UserActor {
                    primaryAccount {
                      id
                      ...AccountFragment
                    }
                  }
                }
              }
              
              ${print(AccountFragmentNode)}
            `,
            {},
            {
              additionalTypenames: ['User', 'SSOUser'],
            }
          )
          .toPromise()
      );
    } catch (error) {
      throw new Error(
        'An error occurred while fetching the primary account of the current user. Check to ensure your session has sufficient scope on your primary account.'
      );
    }

    const actor = data.meActor;
    if (!actor) {
      throw new Error('Must be logged in to perform this action.');
    }

    if (actor.__typename === 'User' || actor.__typename === 'SSOUser') {
      return actor.primaryAccount;
    }

    throw new Error(`This action is not supported for the ${actor.__typename} user type.`);
  },
};
