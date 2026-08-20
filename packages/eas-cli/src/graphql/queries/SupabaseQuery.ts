import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  SupabaseConnectionData,
  SupabaseConnectionFragmentNode,
  SupabaseProjectData,
  SupabaseProjectFragmentNode,
} from '../types/SupabaseConnection';

type SupabaseConnectionByAccountIdQuery = {
  account: {
    byId: {
      id: string;
      supabaseConnection?: SupabaseConnectionData | null;
    };
  };
};

type SupabaseProjectByAppIdQuery = {
  app: {
    byId: {
      id: string;
      supabaseProject?: SupabaseProjectData | null;
    };
  };
};

export const SupabaseQuery = {
  async getSupabaseConnectionByAccountIdAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<SupabaseConnectionData | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<SupabaseConnectionByAccountIdQuery, { accountId: string }>(
          gql`
            query SupabaseConnectionByAccountId($accountId: String!) {
              account {
                byId(accountId: $accountId) {
                  id
                  supabaseConnection {
                    id
                    ...SupabaseConnectionFragment
                  }
                }
              }
            }
            ${print(SupabaseConnectionFragmentNode)}
          `,
          { accountId },
          {
            additionalTypenames: ['SupabaseConnection'],
            requestPolicy: useCache ? 'cache-first' : 'network-only',
          }
        )
        .toPromise()
    );
    return data.account.byId.supabaseConnection ?? null;
  },

  async getSupabaseProjectByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<SupabaseProjectData | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<SupabaseProjectByAppIdQuery, { appId: string }>(
          gql`
            query SupabaseProjectByAppId($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  supabaseProject {
                    id
                    ...SupabaseProjectFragment
                  }
                }
              }
            }
            ${print(SupabaseProjectFragmentNode)}
          `,
          { appId },
          {
            additionalTypenames: ['App', 'SupabaseProject'],
            requestPolicy: useCache ? 'cache-first' : 'network-only',
          }
        )
        .toPromise()
    );
    return data.app.byId.supabaseProject ?? null;
  },
};
