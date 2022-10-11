import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  BuildFragment,
  BuildWithSubmissionsFragment,
  BuildsByIdQuery,
  BuildsByIdQueryVariables,
  BuildsWithSubmissionsByIdQuery,
  BuildsWithSubmissionsByIdQueryVariables,
  ViewBuildsOnAppQuery,
  ViewBuildsOnAppQueryVariables,
} from '../generated';
import { BuildFragmentNode, BuildFragmentWithSubmissionsNode } from '../types/Build';

export const BuildQuery = {
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    buildId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<BuildFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BuildsByIdQuery, BuildsByIdQueryVariables>(
          gql`
            query BuildsByIdQuery($buildId: ID!) {
              builds {
                byId(buildId: $buildId) {
                  id
                  ...BuildFragment
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { buildId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['Build'],
          }
        )
        .toPromise()
    );

    return data.builds.byId;
  },
  async withSubmissionsByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    buildId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<BuildWithSubmissionsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BuildsWithSubmissionsByIdQuery, BuildsWithSubmissionsByIdQueryVariables>(
          gql`
            query BuildsWithSubmissionsByIdQuery($buildId: ID!) {
              builds {
                byId(buildId: $buildId) {
                  id
                  ...BuildWithSubmissionsFragment
                }
              }
            }
            ${print(BuildFragmentWithSubmissionsNode)}
          `,
          { buildId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['Build'],
          }
        )
        .toPromise()
    );

    return data.builds.byId;
  },
  async viewBuildsOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, limit, offset, filter }: ViewBuildsOnAppQueryVariables
  ): Promise<BuildFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewBuildsOnAppQuery, ViewBuildsOnAppQueryVariables>(
          // TODO: Change $appId: String! to ID! when fixed server-side schema
          gql`
            query ViewBuildsOnApp(
              $appId: String!
              $offset: Int!
              $limit: Int!
              $filter: BuildFilter
            ) {
              app {
                byId(appId: $appId) {
                  id
                  builds(offset: $offset, limit: $limit, filter: $filter) {
                    id
                    ...BuildFragment
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { appId, offset, limit, filter },
          {
            additionalTypenames: ['Build'],
          }
        )
        .toPromise()
    );

    return data.app?.byId.builds ?? [];
  },
};
