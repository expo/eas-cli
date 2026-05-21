import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  ExpoGoProjectConfiguration,
  ExpoGoRepackInput,
  WorkflowRunByIdQuery,
  WorkflowRunByIdQueryVariables,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunByIdWithJobsQueryVariables,
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunsForAppIdFileNameAndStatusQuery,
} from '../generated';
import { WorkflowJobFragmentNode } from '../types/WorkflowJob';
import { WorkflowRunFragmentNode } from '../types/WorkflowRun';

type ExpoGoSdkVersion = {
  sdkVersion: string;
  isLatest: boolean;
  isBeta: boolean;
  isDeprecated: boolean;
};

export const WorkflowRunQuery = {
  async expoGoSupportedSdkVersionsAsync(
    graphqlClient: ExpoGraphqlClient
  ): Promise<ExpoGoSdkVersion[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          { expoGoBuild: { supportedSdkVersions: ExpoGoSdkVersion[] } },
          Record<string, never>
        >(
          /* eslint-disable graphql/template-strings */
          gql`
            query ExpoGoSupportedSdkVersions {
              expoGoBuild {
                supportedSdkVersions {
                  sdkVersion
                  isLatest
                  isBeta
                  isDeprecated
                }
              }
            }
          `,
          /* eslint-enable graphql/template-strings */
          {},
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.expoGoBuild.supportedSdkVersions;
  },
  async expoGoRepackConfigurationAsync(
    graphqlClient: ExpoGraphqlClient,
    input: ExpoGoRepackInput
  ): Promise<ExpoGoProjectConfiguration> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          { expoGoBuild: { repackConfiguration: ExpoGoProjectConfiguration } },
          { input: ExpoGoRepackInput }
        >(
          /* eslint-disable graphql/template-strings */
          gql`
            query ExpoGoRepackConfiguration($input: ExpoGoRepackInput!) {
              expoGoBuild {
                repackConfiguration(input: $input) {
                  sdkVersion
                  files {
                    fileName
                    fileContents
                  }
                }
              }
            }
          `,
          /* eslint-enable graphql/template-strings */
          { input },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.expoGoBuild.repackConfiguration;
  },
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowRunId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<WorkflowRunByIdQuery['workflowRuns']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowRunByIdQuery, WorkflowRunByIdQueryVariables>(
          gql`
            query WorkflowRunById($workflowRunId: ID!) {
              workflowRuns {
                byId(workflowRunId: $workflowRunId) {
                  id
                  status
                }
              }
            }
          `,
          { workflowRunId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['WorkflowRun'],
          }
        )
        .toPromise()
    );
    return data.workflowRuns.byId;
  },
  async withJobsByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowRunId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowRunByIdWithJobsQuery, WorkflowRunByIdWithJobsQueryVariables>(
          gql`
            query WorkflowRunByIdWithJobs($workflowRunId: ID!) {
              workflowRuns {
                byId(workflowRunId: $workflowRunId) {
                  id
                  workflow {
                    id
                    app {
                      id
                      name
                      ownerAccount {
                        id
                        name
                      }
                    }
                  }
                  jobs {
                    id
                    ...WorkflowJobFragment
                  }
                  ...WorkflowRunFragment
                }
              }
            }
            ${print(WorkflowRunFragmentNode)}
            ${print(WorkflowJobFragmentNode)}
          `,
          { workflowRunId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['WorkflowRun'],
          }
        )
        .toPromise()
    );
    return data.workflowRuns.byId;
  },
  async byAppIdFileNameAndStatusAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    fileName: string,
    status?: WorkflowRunStatus,
    limit?: number
  ): Promise<WorkflowRunFragment[]> {
    validateLimit(limit);
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowRunsForAppIdFileNameAndStatusQuery>(
          gql`
            query WorkflowRunsForAppIdFileNameAndStatusQuery(
              $appId: ID!
              $fileName: String!
              $status: WorkflowRunStatus
              $limit: Int!
            ) {
              workflows {
                byAppIdAndFileName(appId: $appId, fileName: $fileName) {
                  id
                  runs: runsPaginated(first: $limit, filter: { status: $status }) {
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
          { appId, fileName, status, limit },
          { additionalTypenames: ['Workflow'] }
        )
        .toPromise()
    );
    assert(data.workflows, 'GraphQL: `workflows` not defined in server response');
    return data.workflows.byAppIdAndFileName.runs.edges.map(edge => edge.node);
  },
};

function validateLimit(limit?: number): void {
  assert(limit, 'limit is required');
  assert(limit > 0, 'limit must be greater than 0');
  assert(limit <= 100, 'limit must be less than or equal to 100');
}
