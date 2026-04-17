import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withUpgradeRequiredErrorHandlingAsync } from '../client';
import { ViewUpdateGroupInsightsQuery, ViewUpdateGroupInsightsQueryVariables } from '../generated';

export type UpdateWithInsightsObject = ViewUpdateGroupInsightsQuery['updatesByGroup'][number];

export const UpdateInsightsQuery = {
  async viewUpdateGroupInsightsAsync(
    graphqlClient: ExpoGraphqlClient,
    { groupId, startTime, endTime }: { groupId: string; startTime: string; endTime: string }
  ): Promise<UpdateWithInsightsObject[]> {
    const data = await withUpgradeRequiredErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateGroupInsightsQuery, ViewUpdateGroupInsightsQueryVariables>(
          gql`
            query ViewUpdateGroupInsights($groupId: ID!, $timespan: InsightsTimespan!) {
              updatesByGroup(group: $groupId) {
                id
                platform
                insights {
                  id
                  totalUniqueUsers(timespan: $timespan)
                  cumulativeAverageMetrics {
                    launchAssetCount
                    averageUpdatePayloadBytes
                  }
                  cumulativeMetrics(timespan: $timespan) {
                    metricsAtLastTimestamp {
                      totalInstalls
                      totalFailedInstalls
                    }
                    data {
                      labels
                      installsDataset {
                        id
                        label
                        cumulative
                        difference
                      }
                      failedInstallsDataset {
                        id
                        label
                        cumulative
                        difference
                      }
                    }
                  }
                }
              }
            }
          `,
          { groupId, timespan: { start: startTime, end: endTime } },
          { additionalTypenames: ['Update', 'UpdateInsights'] }
        )
        .toPromise(),
      { featureName: 'EAS Update insights' }
    );

    if (data.updatesByGroup.length === 0) {
      throw new Error(`Could not find any updates with group ID: "${groupId}"`);
    }

    return data.updatesByGroup;
  },
};
