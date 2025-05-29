/* eslint-disable graphql/template-strings */
import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppByFullNameQuery,
  AppByIdQuery,
  AppByIdWorkflowRunsQuery,
  AppByIdWorkflowsQuery,
  AppFragment,
  AppWorkflowRunsFragment,
  AppWorkflowsFragment,
} from '../generated';
import {
  AppFragmentNode,
  AppWorkflowRunsFragmentNode,
  AppWorkflowsFragmentNode,
} from '../types/App';

export const AppQuery = {
  async byIdAsync(graphqlClient: ExpoGraphqlClient, projectId: string): Promise<AppFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdQuery>(
          gql`
            query AppByIdQuery($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ...AppFragment
                }
              }
            }
            ${print(AppFragmentNode)}
          `,
          { appId: projectId },
          {
            additionalTypenames: ['App'],
          }
        )
        .toPromise()
    );

    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId;
  },
  async byFullNameAsync(graphqlClient: ExpoGraphqlClient, fullName: string): Promise<AppFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByFullNameQuery>(
          gql`
            query AppByFullNameQuery($fullName: String!) {
              app {
                byFullName(fullName: $fullName) {
                  id
                  ...AppFragment
                }
              }
            }
            ${print(AppFragmentNode)}
          `,
          { fullName },
          {
            additionalTypenames: ['App'],
          }
        )
        .toPromise()
    );

    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName;
  },
  async byIdWorkflowsAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<AppWorkflowsFragment['workflows']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdWorkflowsQuery>(
          gql`
            query AppByIdWorkflowsQuery($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ...AppWorkflowsFragment
                }
              }
            }
            ${print(AppWorkflowsFragmentNode)}
          `,
          { appId },
          { additionalTypenames: ['App'] }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId.workflows;
  },
  async byIdWorkflowRunsAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    limit?: number
  ): Promise<AppWorkflowRunsFragment['runs']> {
    validateLimit(limit);
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdWorkflowRunsQuery>(
          gql`
            query AppByIdWorkflowRunsQuery($appId: String!, $limit: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  ...AppWorkflowRunsFragment
                }
              }
            }
            ${print(AppWorkflowRunsFragmentNode)}
          `,
          { appId, limit },
          { additionalTypenames: ['App'] }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId.runs;
  },
};

function validateLimit(limit?: number): void {
  assert(limit, 'limit is required');
  assert(limit > 0, 'limit must be greater than 0');
  assert(limit <= 100, 'limit must be less than or equal to 100');
}
