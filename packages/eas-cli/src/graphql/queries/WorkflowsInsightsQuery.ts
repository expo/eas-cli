import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withUpgradeRequiredErrorHandlingAsync } from '../client';
import {
  WorkflowsInsightsByAppIdQuery,
  WorkflowsInsightsByAppIdQueryVariables,
  WorkflowsInsightsFiltersInput,
  WorkflowsInsightsRunsOverTimeGranularity,
} from '../generated';

export type AppWithWorkflowsInsightsObject = WorkflowsInsightsByAppIdQuery['app']['byId'];

export const WorkflowsInsightsQuery = {
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      startTime,
      endTime,
      filters,
      granularity,
      first,
    }: {
      appId: string;
      startTime: string;
      endTime: string;
      filters?: WorkflowsInsightsFiltersInput;
      granularity: WorkflowsInsightsRunsOverTimeGranularity;
      first: number;
    }
  ): Promise<AppWithWorkflowsInsightsObject> {
    const data = await withUpgradeRequiredErrorHandlingAsync(
      graphqlClient
        .query<WorkflowsInsightsByAppIdQuery, WorkflowsInsightsByAppIdQueryVariables>(
          gql`
            query WorkflowsInsightsByAppId(
              $appId: String!
              $timespan: WorkflowsInsightsTimespanInput!
              $filters: WorkflowsInsightsFiltersInput
              $granularity: WorkflowsInsightsRunsOverTimeGranularity!
              $first: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  fullName
                  workflowsInsights {
                    overviewMetrics(timespan: $timespan, filters: $filters) {
                      totalRuns {
                        currentValue
                        previousValue
                      }
                      successfulRuns {
                        currentValue
                        previousValue
                      }
                      failedRuns {
                        currentValue
                        previousValue
                      }
                      activeWorkflows {
                        currentValue
                        previousValue
                      }
                    }
                    runsOverTime(timespan: $timespan, filters: $filters, granularity: $granularity) {
                      lineChart {
                        labels
                        datasets {
                          id
                          data
                        }
                      }
                    }
                    workflows(timespan: $timespan, filters: $filters, first: $first) {
                      edges {
                        node {
                          workflowId
                          name
                          totalRuns
                          successfulRuns
                          failedRuns
                          canceledRuns
                          lastRunAt
                        }
                      }
                      pageInfo {
                        hasNextPage
                      }
                    }
                  }
                }
              }
            }
          `,
          {
            appId,
            timespan: { start: startTime, end: endTime },
            filters,
            granularity,
            first,
          },
          { additionalTypenames: ['App', 'AppWorkflowsInsights'] }
        )
        .toPromise(),
      { featureName: 'EAS Workflows insights' }
    );

    return data.app.byId;
  },
};
