import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  ConvexProjectData,
  ConvexProjectFragmentNode,
  ConvexTeamConnectionData,
  ConvexTeamConnectionFragmentNode,
} from '../types/ConvexTeamConnection';

type ConvexTeamConnectionsByAccountIdQuery = {
  account: {
    byId: {
      id: string;
      convexTeamConnections: ConvexTeamConnectionData[];
    };
  };
};

type ConvexTeamConnectionsByAccountIdQueryVariables = {
  accountId: string;
};

type ConvexProjectByAppIdQuery = {
  app: {
    byId: {
      id: string;
      convexProject?: ConvexProjectData | null;
    };
  };
};

type ConvexProjectByAppIdQueryVariables = {
  appId: string;
};

export const ConvexQuery = {
  async getConvexTeamConnectionsByAccountIdAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string
  ): Promise<ConvexTeamConnectionData[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          ConvexTeamConnectionsByAccountIdQuery,
          ConvexTeamConnectionsByAccountIdQueryVariables
        >(
          gql`
            query ConvexTeamConnectionsByAccountId($accountId: String!) {
              account {
                byId(accountId: $accountId) {
                  id
                  convexTeamConnections {
                    id
                    ...ConvexTeamConnectionFragment
                  }
                }
              }
            }
            ${print(ConvexTeamConnectionFragmentNode)}
          `,
          { accountId }
        )
        .toPromise()
    );

    return data.account.byId.convexTeamConnections;
  },

  async getConvexProjectByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<ConvexProjectData | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ConvexProjectByAppIdQuery, ConvexProjectByAppIdQueryVariables>(
          gql`
            query ConvexProjectByAppId($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  convexProject {
                    id
                    ...ConvexProjectFragment
                  }
                }
              }
            }
            ${print(ConvexTeamConnectionFragmentNode)}
            ${print(ConvexProjectFragmentNode)}
          `,
          { appId },
          { additionalTypenames: ['App', 'ConvexProject'] }
        )
        .toPromise()
    );

    return data.app.byId.convexProject ?? null;
  },
};
