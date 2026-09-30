import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withUpgradeRequiredErrorHandlingAsync } from '../client';
import {
  WorkflowDeviceTestCaseHistoryByAppIdQuery,
  WorkflowDeviceTestCaseHistoryByAppIdQueryVariables,
  WorkflowDeviceTestCaseHistoryFiltersInput,
  WorkflowDeviceTestCaseInsightsByAppIdQuery,
  WorkflowDeviceTestCaseInsightsByAppIdQueryVariables,
  WorkflowDeviceTestCaseInsightsFiltersInput,
  WorkflowDeviceTestCaseInsightsTimeSeriesGranularity,
  WorkflowDeviceTestCaseSortDirection,
  WorkflowDeviceTestCaseStatSortField,
} from '../generated';

export type AppWithMaestroInsightsObject =
  WorkflowDeviceTestCaseInsightsByAppIdQuery['app']['byId'];
export type AppWithMaestroFlowHistoryObject =
  WorkflowDeviceTestCaseHistoryByAppIdQuery['app']['byId'];

const FEATURE_NAME = 'EAS Maestro insights';

export const WorkflowDeviceTestCaseInsightsQuery = {
  async insightsByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      startTime,
      endTime,
      filters,
      granularity,
      sortField,
      sortDirection,
      search,
      first,
    }: {
      appId: string;
      startTime: string;
      endTime: string;
      filters?: WorkflowDeviceTestCaseInsightsFiltersInput;
      granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
      sortField: WorkflowDeviceTestCaseStatSortField;
      sortDirection: WorkflowDeviceTestCaseSortDirection;
      search?: string;
      first: number;
    }
  ): Promise<AppWithMaestroInsightsObject> {
    const data = await withUpgradeRequiredErrorHandlingAsync(
      graphqlClient
        .query<
          WorkflowDeviceTestCaseInsightsByAppIdQuery,
          WorkflowDeviceTestCaseInsightsByAppIdQueryVariables
        >(
          gql`
            query WorkflowDeviceTestCaseInsightsByAppId(
              $appId: String!
              $timespan: WorkflowDeviceTestCaseInsightsTimespanInput!
              $filters: WorkflowDeviceTestCaseInsightsFiltersInput
              $granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity!
              $sortField: WorkflowDeviceTestCaseStatSortField
              $sortDirection: WorkflowDeviceTestCaseSortDirection
              $search: String
              $first: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  fullName
                  workflowDeviceTestCaseInsights(timespan: $timespan, filters: $filters) {
                    totals {
                      totalRuns {
                        currentValue
                        previousValue
                      }
                      passedCleanCount {
                        currentValue
                        previousValue
                      }
                      flakyCount {
                        currentValue
                        previousValue
                      }
                      distinctFlakyTestCount {
                        currentValue
                        previousValue
                      }
                      avgDurationMs {
                        currentValue
                        previousValue
                      }
                    }
                    timeSeries(granularity: $granularity) {
                      bucketStartAt
                      passedClean
                      flaky
                      failed
                    }
                    tests(
                      sortField: $sortField
                      sortDirection: $sortDirection
                      search: $search
                      first: $first
                    ) {
                      edges {
                        node {
                          path
                          name
                          totalRuns
                          passedCleanCount
                          flakyCount
                          failedCount
                          p90DurationMs
                          lastRunAt
                          lastRunStatus
                          lastRunIsFlaky
                        }
                      }
                      pageInfo {
                        hasNextPage
                      }
                      totalCount
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
            sortField,
            sortDirection,
            search,
            first,
          },
          { additionalTypenames: ['App', 'WorkflowDeviceTestCaseInsights'] }
        )
        .toPromise(),
      { featureName: FEATURE_NAME }
    );

    return data.app.byId;
  },

  async historyByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      path,
      startTime,
      endTime,
      filters,
      granularity,
      errorPatternsFirst,
      recentRunsFirst,
    }: {
      appId: string;
      path: string;
      startTime: string;
      endTime: string;
      filters?: WorkflowDeviceTestCaseHistoryFiltersInput;
      granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
      errorPatternsFirst: number;
      recentRunsFirst: number;
    }
  ): Promise<AppWithMaestroFlowHistoryObject> {
    const data = await withUpgradeRequiredErrorHandlingAsync(
      graphqlClient
        .query<
          WorkflowDeviceTestCaseHistoryByAppIdQuery,
          WorkflowDeviceTestCaseHistoryByAppIdQueryVariables
        >(
          gql`
            query WorkflowDeviceTestCaseHistoryByAppId(
              $appId: String!
              $path: String!
              $timespan: WorkflowDeviceTestCaseInsightsTimespanInput!
              $filters: WorkflowDeviceTestCaseHistoryFiltersInput
              $granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity!
              $errorPatternsFirst: Int!
              $recentRunsFirst: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  fullName
                  workflowDeviceTestCaseHistory(path: $path, timespan: $timespan, filters: $filters) {
                    totals {
                      totalRuns {
                        currentValue
                      }
                      passedCleanCount {
                        currentValue
                      }
                      flakyCount {
                        currentValue
                      }
                      p90DurationMs {
                        currentValue
                      }
                    }
                    timeSeries(granularity: $granularity) {
                      bucketStartAt
                      passedClean
                      flaky
                      failed
                    }
                    errorPatterns(first: $errorPatternsFirst) {
                      sampleMessage
                      count
                    }
                    recentRuns(first: $recentRunsFirst) {
                      edges {
                        node {
                          id
                          status
                          durationMs
                          isFlaky
                          createdAt
                          workflowRunId
                          workflowRunName
                          gitRef
                          commitSha
                        }
                      }
                      pageInfo {
                        hasNextPage
                      }
                      totalCount
                    }
                  }
                }
              }
            }
          `,
          {
            appId,
            path,
            timespan: { start: startTime, end: endTime },
            filters,
            granularity,
            errorPatternsFirst,
            recentRunsFirst,
          },
          { additionalTypenames: ['App', 'WorkflowDeviceTestCaseHistory'] }
        )
        .toPromise(),
      { featureName: FEATURE_NAME }
    );

    return data.app.byId;
  },
};
