import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppObservePlatform,
  AppObserveTimeSeriesInput,
  AppObserveVersionMarker,
} from '../generated';

type AppObserveTimeSeriesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        timeSeries: {
          versionMarkers: AppObserveVersionMarker[];
        };
      };
    };
  };
};

type AppObserveTimeSeriesQueryVariables = {
  appId: string;
  input: Pick<AppObserveTimeSeriesInput, 'metricName' | 'platform' | 'startTime' | 'endTime'>;
};

export const ObserveQuery = {
  async timeSeriesVersionMarkersAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      metricName,
      platform,
      startTime,
      endTime,
    }: {
      appId: string;
      metricName: string;
      platform: AppObservePlatform;
      startTime: string;
      endTime: string;
    }
  ): Promise<AppObserveVersionMarker[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveTimeSeriesQuery, AppObserveTimeSeriesQueryVariables>(
          gql`
            query AppObserveTimeSeries(
              $appId: String!
              $input: AppObserveTimeSeriesInput!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    timeSeries(input: $input) {
                      versionMarkers {
                        appVersion
                        eventCount
                        firstSeenAt
                        statistics {
                          min
                          max
                          median
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
            input: { metricName, platform, startTime, endTime },
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.timeSeries.versionMarkers;
  },
};
