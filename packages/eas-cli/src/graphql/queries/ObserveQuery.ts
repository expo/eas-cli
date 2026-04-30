import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppObserveAppVersion,
  AppObserveEvent,
  AppObserveEventsFilter,
  AppObserveEventsOrderBy,
  AppObservePlatform,
  AppObserveReleasesInput,
  AppObserveTimeSeriesInput,
  AppObserveTimeSeriesStatistics,
  PageInfo,
} from '../generated';
import { print } from 'graphql';
import {
  AppObserveAppVersionFragmentNode,
  AppObserveTimeSeriesFragmentNode,
  AppObserveEventFragmentNode,
} from '../types/Observe';

export type AppObserveTimeSeriesResult = {
  appVersionMarkers: AppObserveAppVersion[];
  eventCount: number;
  statistics: AppObserveTimeSeriesStatistics;
};

type AppObserveTimeSeriesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        timeSeries: AppObserveTimeSeriesResult;
      };
    };
  };
};

type AppObserveTimeSeriesQueryVariables = {
  appId: string;
  input: Pick<AppObserveTimeSeriesInput, 'metricName' | 'platform' | 'startTime' | 'endTime'>;
};

type AppObserveAppVersionsQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        appVersions: AppObserveAppVersion[];
      };
    };
  };
};

type AppObserveAppVersionsQueryVariables = {
  appId: string;
  input: AppObserveReleasesInput;
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
  async timeSeriesAsync(
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
  ): Promise<AppObserveTimeSeriesResult> {
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
                      ...AppObserveTimeSeriesFragment
                    }
                  }
                }
              }
            }
            ${print(AppObserveAppVersionFragmentNode)}
            ${print(AppObserveTimeSeriesFragmentNode)}
          `,
          {
            appId,
            input: { metricName, platform, startTime, endTime },
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.timeSeries;
  },

  async appVersionsAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      platform,
      startTime,
      endTime,
      metricNames,
    }: {
      appId: string;
      platform: AppObservePlatform;
      startTime: string;
      endTime: string;
      metricNames?: string[];
    }
  ): Promise<AppObserveAppVersion[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveAppVersionsQuery, AppObserveAppVersionsQueryVariables>(
          gql`
            query AppObserveAppVersions(
              $appId: String!
              $input: AppObserveReleasesInput!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    appVersions(input: $input) {
                      ...AppObserveAppVersionFragment
                    }
                  }
                }
              }
            }
            ${print(AppObserveAppVersionFragmentNode)}
          `,
          {
            appId,
            input: { platform, startTime, endTime, ...(metricNames && { metricNames }) },
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.appVersions;
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
                          ...AppObserveEventFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveEventFragmentNode)}
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
