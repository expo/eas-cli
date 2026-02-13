import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppObserveEvent,
  AppObserveEventsFilter,
  AppObserveEventsOrderBy,
  AppObservePlatform,
  AppObserveTimeSeriesInput,
  AppObserveVersionMarker,
  PageInfo,
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

type AppObserveEventsQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        events: {
          pageInfo: PageInfo;
          edges: Array<{
            cursor: string;
            node: AppObserveEvent;
          }>;
        };
      };
    };
  };
};

type AppObserveEventsQueryVariables = {
  appId: string;
  filter?: AppObserveEventsFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveEventsOrderBy;
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

  async eventsAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveEventsQueryVariables
  ): Promise<{ events: AppObserveEvent[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveEventsQuery, AppObserveEventsQueryVariables>(
          gql`
            query AppObserveEvents(
              $appId: String!
              $filter: AppObserveEventsFilter
              $first: Int
              $after: String
              $orderBy: AppObserveEventsOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    events(
                      filter: $filter
                      first: $first
                      after: $after
                      orderBy: $orderBy
                    ) {
                      pageInfo {
                        hasNextPage
                        hasPreviousPage
                        endCursor
                      }
                      edges {
                        cursor
                        node {
                          id
                          metricName
                          metricValue
                          timestamp
                          appVersion
                          appBuildNumber
                          deviceModel
                          deviceOs
                          deviceOsVersion
                          countryCode
                          sessionId
                          easClientId
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.events;
    return {
      events: edges.map(edge => edge.node),
      pageInfo,
    };
  },
};
