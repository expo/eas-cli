import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { CurrentUserQuery } from '../generated';
import { AccountFragmentNode } from '../types/Account';

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
                ... on UserActor {
                  username
                  primaryAccount {
                    id
                    ...AccountFragment
                  }
                  preferences {
                    onboarding {
                      appId
                      platform
                      deviceType
                      environment
                      isCLIDone
                      lastUsed
                    }
                  }
                }
                ... on Robot {
                  firstName
                }
                accounts {
                  id
                  ...AccountFragment
                }
                featureGates
                isExpoAdmin
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

    return data.meActor;
  },
};
