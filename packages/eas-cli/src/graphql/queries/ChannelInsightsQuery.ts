import gql from 'graphql-tag';

import { ChannelNotFoundError } from '../../channel/errors';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withUpgradeRequiredErrorHandlingAsync } from '../client';
import {
  ViewChannelRuntimeInsightsOnAppQuery,
  ViewChannelRuntimeInsightsOnAppQueryVariables,
} from '../generated';

export type ChannelRuntimeInsights = NonNullable<
  ViewChannelRuntimeInsightsOnAppQuery['app']['byId']['updateChannelByName']
>['runtimeInsights'];

export const ChannelInsightsQuery = {
  async viewChannelRuntimeInsightsAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      channelName,
      runtimeVersion,
      startTime,
      endTime,
    }: {
      appId: string;
      channelName: string;
      runtimeVersion: string;
      startTime: string;
      endTime: string;
    }
  ): Promise<ChannelRuntimeInsights> {
    const data = await withUpgradeRequiredErrorHandlingAsync(
      graphqlClient
        .query<ViewChannelRuntimeInsightsOnAppQuery, ViewChannelRuntimeInsightsOnAppQueryVariables>(
          gql`
            query ViewChannelRuntimeInsightsOnApp(
              $appId: String!
              $channelName: String!
              $runtimeVersion: String!
              $timespan: InsightsTimespan!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    name
                    runtimeInsights {
                      id
                      embeddedUpdateTotalUniqueUsers(runtimeVersion: $runtimeVersion, timespan: $timespan)
                      mostPopularUpdates(runtimeVersion: $runtimeVersion, timespan: $timespan) {
                        id
                        group
                        message
                        runtimeVersion
                        platform
                        insights {
                          id
                          totalUniqueUsers(timespan: $timespan)
                        }
                      }
                      uniqueUsersOverTime(runtimeVersion: $runtimeVersion, timespan: $timespan) {
                        data {
                          labels
                          datasets {
                            id
                            label
                            data
                          }
                        }
                      }
                      cumulativeMetricsOverTime(runtimeVersion: $runtimeVersion, timespan: $timespan) {
                        data {
                          labels
                          datasets {
                            id
                            label
                            data
                          }
                        }
                        metricsAtLastTimestamp {
                          id
                          label
                          data
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          {
            appId,
            channelName,
            runtimeVersion,
            timespan: { start: startTime, end: endTime },
          },
          { additionalTypenames: ['UpdateChannel', 'Update', 'UpdateChannelRuntimeInsights'] }
        )
        .toPromise(),
      { featureName: 'EAS Update channel insights' }
    );

    const updateChannel = data.app.byId.updateChannelByName;
    if (!updateChannel) {
      throw new ChannelNotFoundError(`Could not find channel with the name ${channelName}`);
    }

    return updateChannel.runtimeInsights;
  },
};
