/* eslint-disable graphql/template-strings */
import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppByFullNameQuery,
  AppByIdQuery,
  AppByIdWorkflowRunsFilteredByStatusQuery,
  AppByIdWorkflowsQuery,
  AppFragment,
  WorkflowFragment,
  WorkflowRunFragment,
  WorkflowRunStatus,
} from '../generated';
import { AppFragmentNode } from '../types/App';
import { WorkflowFragmentNode } from '../types/Workflow';
import { WorkflowRunFragmentNode } from '../types/WorkflowRun';

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
  ): Promise<WorkflowFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdWorkflowsQuery>(
          gql`
            query AppByIdWorkflowsQuery($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  workflows {
                    id
                    ...WorkflowFragment
                  }
                }
              }
            }
            ${print(WorkflowFragmentNode)}
          `,
          { appId },
          { additionalTypenames: ['App'] }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId.workflows;
  },
  async byIdWorkflowRunsFilteredByStatusAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    status?: WorkflowRunStatus,
    limit?: number
  ): Promise<WorkflowRunFragment[]> {
    validateLimit(limit);
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdWorkflowRunsFilteredByStatusQuery>(
          gql`
            query AppByIdWorkflowRunsFilteredByStatusQuery(
              $appId: String!
              $status: WorkflowRunStatus
              $limit: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  runs: workflowRunsPaginated(last: $limit, filter: { status: $status }) {
                    edges {
                      node {
                        id
                        ...WorkflowRunFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(WorkflowRunFragmentNode)}
          `,
          { appId, status, limit },
          { additionalTypenames: ['App'] }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId.runs.edges.map(edge => edge.node);
  },
};

function validateLimit(limit?: number): void {
  assert(limit, 'limit is required');
  assert(limit > 0, 'limit must be greater than 0');
  assert(limit <= 100, 'limit must be less than or equal to 100');
}
