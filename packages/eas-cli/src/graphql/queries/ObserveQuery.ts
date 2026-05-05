import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppObserveAppVersion,
  AppObserveCustomEvent,
  AppObserveCustomEventListFilter,
  AppObserveCustomEventName,
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
  AppObserveCustomEventFragmentNode,
  AppObserveEventFragmentNode,
  AppObserveTimeSeriesFragmentNode,
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

type AppObserveCustomEventListQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        customEventList: {
          pageInfo: PageInfo;
          edges: Array<{
            cursor: string;
            node: AppObserveCustomEvent;
          }>;
        };
      };
    };
  };
};

type AppObserveCustomEventListQueryVariables = {
  appId: string;
  filter?: AppObserveCustomEventListFilter;
  first?: number;
  after?: string;
};

type AppObserveCustomEventNamesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        customEventNames: {
          isTruncated: boolean;
          names: AppObserveCustomEventName[];
        };
      };
    };
  };
};

type AppObserveCustomEventNamesQueryVariables = {
  appId: string;
  startTime: string;
  endTime: string;
  platform?: AppObservePlatform;
  environment?: string;
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

  async customEventListAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveCustomEventListQueryVariables
  ): Promise<{ events: AppObserveCustomEvent[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveCustomEventListQuery, AppObserveCustomEventListQueryVariables>(
          gql`
            query AppObserveCustomEventList(
              $appId: String!
              $filter: AppObserveCustomEventListFilter
              $first: Int
              $after: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    customEventList(filter: $filter, first: $first, after: $after) {
                      pageInfo {
                        hasNextPage
                        hasPreviousPage
                        endCursor
                      }
                      edges {
                        cursor
                        node {
                          id
                          ...AppObserveCustomEventFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveCustomEventFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.customEventList;
    return {
      events: edges.map(edge => edge.node),
      pageInfo,
    };
  },

  async customEventNamesAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      startTime,
      endTime,
      platform,
      environment,
    }: {
      appId: string;
      startTime: string;
      endTime: string;
      platform?: AppObservePlatform;
      environment?: string;
    }
  ): Promise<{ names: AppObserveCustomEventName[]; isTruncated: boolean }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveCustomEventNamesQuery, AppObserveCustomEventNamesQueryVariables>(
          gql`
            query AppObserveCustomEventNames(
              $appId: String!
              $startTime: DateTime!
              $endTime: DateTime!
              $platform: AppObservePlatform
              $environment: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    customEventNames(
                      startTime: $startTime
                      endTime: $endTime
                      platform: $platform
                      environment: $environment
                    ) {
                      isTruncated
                      names {
                        eventName
                        count
                      }
                    }
                  }
                }
              }
            }
          `,
          {
            appId,
            startTime,
            endTime,
            ...(platform && { platform }),
            ...(environment && { environment }),
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.customEventNames;
  },
};
