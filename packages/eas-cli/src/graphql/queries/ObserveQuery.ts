import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppObserveAppVersion,
  AppObserveError,
  AppObserveErrorGroup,
  AppObserveErrorOccurrencesFilter,
  AppObserveErrorOccurrencesOrderBy,
  AppObserveErrorsGroupsInput,
  AppObserveLogsOrderBy,
  AppObserveMetric,
  AppObserveMetricsListFilter,
  AppObserveMetricsListOrderBy,
  AppObserveNavigationFilter,
  AppObserveNavigationOrderBy,
  AppObserveNavigationRoute,
  AppObservePlatform,
  AppObserveReleasesInput,
  AppObserveSpan,
  AppObserveSpanListFilter,
  AppObserveSpanListOrderBy,
  AppObserveSpanName,
  AppObserveSpanNamesInput,
  AppObserveTrace,
  AppObserveUserEvent,
  AppObserveUserEventListFilter,
  AppObserveUserEventListOrderBy,
  AppObserveUserEventName,
  PageInfo,
} from '../generated';
import { print } from 'graphql';
import {
  AppObserveAppVersionFragmentNode,
  AppObserveErrorFragmentNode,
  AppObserveErrorGroupFragmentNode,
  AppObserveErrorOccurrenceFragmentNode,
  AppObserveMetricFragmentNode,
  AppObserveSpanFragmentNode,
  AppObserveUserEventFragmentNode,
} from '../types/Observe';

/** A `session.logs` node is a user event or an error (the `AppObserveLog` interface). */
export type AppObserveSessionLog =
  | ({ __typename: 'AppObserveUserEvent' } & AppObserveUserEvent)
  | ({ __typename: 'AppObserveError' } & AppObserveError);

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

type AppObserveMetricsListQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        metrics: {
          list: {
            pageInfo: PageInfo;
            edges: Array<{
              cursor: string;
              node: AppObserveMetric;
            }>;
          };
        };
      };
    };
  };
};

type AppObserveMetricsListQueryVariables = {
  appId: string;
  filter?: AppObserveMetricsListFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveMetricsListOrderBy;
};

type AppObserveUserEventListQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        userEvents: {
          list: {
            pageInfo: PageInfo;
            edges: Array<{
              cursor: string;
              node: AppObserveUserEvent;
            }>;
          };
        };
      };
    };
  };
};

type AppObserveUserEventListQueryVariables = {
  appId: string;
  filter?: AppObserveUserEventListFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveUserEventListOrderBy;
};

type AppObserveUserEventNamesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        userEvents: {
          names: {
            isTruncated: boolean;
            names: AppObserveUserEventName[];
          };
        };
      };
    };
  };
};

type AppObserveUserEventNamesQueryVariables = {
  appId: string;
  input: {
    startTime: string;
    endTime: string;
    platforms?: AppObservePlatform[];
    environment?: string;
  };
};

type AppObserveNavigationRoutesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        navigation: {
          routes: {
            pageInfo: PageInfo;
            edges: Array<{
              cursor: string;
              node: AppObserveNavigationRoute;
            }>;
          };
        };
      };
    };
  };
};

type AppObserveNavigationRoutesQueryVariables = {
  appId: string;
  filter: AppObserveNavigationFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveNavigationOrderBy;
};

type AppObserveErrorGroupsQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        errors: {
          groups: {
            isTruncated: boolean;
            groups: AppObserveErrorGroup[];
          };
        };
      };
    };
  };
};

type AppObserveErrorGroupsQueryVariables = {
  appId: string;
  input: AppObserveErrorsGroupsInput;
};

type AppObserveErrorOccurrencesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        errors: {
          occurrences: {
            pageInfo: PageInfo;
            edges: Array<{ cursor: string; node: AppObserveError }>;
          };
        };
      };
    };
  };
};

type AppObserveErrorOccurrencesQueryVariables = {
  appId: string;
  filter: AppObserveErrorOccurrencesFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveErrorOccurrencesOrderBy;
};

type AppObserveSessionEventsQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        session: {
          id: string;
          metrics: {
            pageInfo: PageInfo;
            edges: Array<{ node: AppObserveMetric }>;
          };
          logs: {
            pageInfo: PageInfo;
            edges: Array<{ node: AppObserveSessionLog }>;
          };
          spans: {
            pageInfo: PageInfo;
            edges: Array<{ node: AppObserveSpan }>;
          };
        };
      };
    };
  };
};

type AppObserveSessionEventsQueryVariables = {
  appId: string;
  id: string;
  first?: number;
  metricsOrderBy?: AppObserveMetricsListOrderBy;
  logsOrderBy?: AppObserveLogsOrderBy;
  spansOrderBy?: AppObserveSpanListOrderBy;
};

type AppObserveSpanListQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        traces: {
          spans: {
            pageInfo: PageInfo;
            edges: Array<{
              cursor: string;
              node: AppObserveSpan;
            }>;
          };
        };
      };
    };
  };
};

type AppObserveSpanListQueryVariables = {
  appId: string;
  filter: AppObserveSpanListFilter;
  first?: number;
  after?: string;
  orderBy?: AppObserveSpanListOrderBy;
};

type AppObserveSpanNamesQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        traces: {
          names: {
            isTruncated: boolean;
            names: AppObserveSpanName[];
          };
        };
      };
    };
  };
};

type AppObserveSpanNamesQueryVariables = {
  appId: string;
  input: AppObserveSpanNamesInput;
};

type AppObserveTraceByIdQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        traces: {
          trace: AppObserveTrace | null;
        };
      };
    };
  };
};

type AppObserveMetricByIdQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        metrics: {
          metric: AppObserveMetric | null;
        };
      };
    };
  };
};

type AppObserveLogByIdQuery = {
  app: {
    byId: {
      id: string;
      observe: {
        log: AppObserveSessionLog | null;
      };
    };
  };
};

type AppObserveByIdQueryVariables = {
  appId: string;
  id: string;
};

export const ObserveQuery = {
  async appVersionsAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      platforms,
      startTime,
      endTime,
      metricNames,
      environment,
    }: {
      appId: string;
      platforms: AppObservePlatform[];
      startTime: string;
      endTime: string;
      metricNames?: string[];
      environment?: string;
    }
  ): Promise<AppObserveAppVersion[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveAppVersionsQuery, AppObserveAppVersionsQueryVariables>(
          gql`
            query AppObserveAppVersions($appId: String!, $input: AppObserveReleasesInput!) {
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
            input: {
              platforms,
              startTime,
              endTime,
              ...(metricNames && { metricNames }),
              ...(environment && { environment }),
            },
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.appVersions;
  },

  async eventsAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveMetricsListQueryVariables
  ): Promise<{ events: AppObserveMetric[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveMetricsListQuery, AppObserveMetricsListQueryVariables>(
          gql`
            query AppObserveMetricsList(
              $appId: String!
              $filter: AppObserveMetricsListFilter
              $first: Int
              $after: String
              $orderBy: AppObserveMetricsListOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    metrics {
                      list(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          cursor
                          node {
                            id
                            ...AppObserveMetricFragment
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveMetricFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.metrics.list;
    return {
      events: edges.map(edge => edge.node),
      pageInfo,
    };
  },

  async customEventListAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveUserEventListQueryVariables
  ): Promise<{ events: AppObserveUserEvent[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveUserEventListQuery, AppObserveUserEventListQueryVariables>(
          gql`
            query AppObserveUserEventList(
              $appId: String!
              $filter: AppObserveUserEventListFilter
              $first: Int
              $after: String
              $orderBy: AppObserveUserEventListOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    userEvents {
                      list(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          cursor
                          node {
                            id
                            ...AppObserveUserEventFragment
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveUserEventFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.userEvents.list;
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
      platforms,
      environment,
    }: {
      appId: string;
      startTime: string;
      endTime: string;
      platforms?: AppObservePlatform[];
      environment?: string;
    }
  ): Promise<{ names: AppObserveUserEventName[]; isTruncated: boolean }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveUserEventNamesQuery, AppObserveUserEventNamesQueryVariables>(
          gql`
            query AppObserveUserEventNames($appId: String!, $input: AppObserveUserEventNamesInput!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    userEvents {
                      names(input: $input) {
                        isTruncated
                        names {
                          name
                          count
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
            input: {
              startTime,
              endTime,
              ...(platforms?.length && { platforms }),
              ...(environment && { environment }),
            },
          }
        )
        .toPromise()
    );

    return data.app.byId.observe.userEvents.names;
  },

  async navigationRoutesAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveNavigationRoutesQueryVariables
  ): Promise<{ routes: AppObserveNavigationRoute[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveNavigationRoutesQuery, AppObserveNavigationRoutesQueryVariables>(
          gql`
            query AppObserveNavigationRoutes(
              $appId: String!
              $filter: AppObserveNavigationFilter!
              $first: Int
              $after: String
              $orderBy: AppObserveNavigationOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    navigation {
                      routes(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          cursor
                          node {
                            routeName
                            coldTtr {
                              count
                              median
                              p90
                            }
                            warmTtr {
                              count
                              median
                              p90
                            }
                            tti {
                              count
                              median
                              p90
                            }
                          }
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

    const { edges, pageInfo } = data.app.byId.observe.navigation.routes;
    return {
      routes: edges.map(edge => edge.node),
      pageInfo,
    };
  },

  async errorGroupsAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, input }: { appId: string; input: AppObserveErrorsGroupsInput }
  ): Promise<{ groups: AppObserveErrorGroup[]; isTruncated: boolean }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveErrorGroupsQuery, AppObserveErrorGroupsQueryVariables>(
          gql`
            query AppObserveErrorGroups($appId: String!, $input: AppObserveErrorsGroupsInput!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    errors {
                      groups(input: $input) {
                        isTruncated
                        groups {
                          ...AppObserveErrorGroupFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveErrorGroupFragmentNode)}
          `,
          { appId, input }
        )
        .toPromise()
    );

    return data.app.byId.observe.errors.groups;
  },

  async errorOccurrencesAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveErrorOccurrencesQueryVariables
  ): Promise<{ occurrences: AppObserveError[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveErrorOccurrencesQuery, AppObserveErrorOccurrencesQueryVariables>(
          gql`
            query AppObserveErrorOccurrences(
              $appId: String!
              $filter: AppObserveErrorOccurrencesFilter
              $first: Int
              $after: String
              $orderBy: AppObserveErrorOccurrencesOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    errors {
                      occurrences(
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
                            ...AppObserveErrorOccurrenceFragment
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveErrorOccurrenceFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.errors.occurrences;
    return {
      occurrences: edges.map(edge => edge.node),
      pageInfo,
    };
  },

  async sessionEventsAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveSessionEventsQueryVariables
  ): Promise<{
    metrics: AppObserveMetric[];
    logs: AppObserveSessionLog[];
    spans: AppObserveSpan[];
    metricsPageInfo: PageInfo;
    logsPageInfo: PageInfo;
    spansPageInfo: PageInfo;
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveSessionEventsQuery, AppObserveSessionEventsQueryVariables>(
          gql`
            query AppObserveSessionEvents(
              $appId: String!
              $id: ID!
              $first: Int
              $metricsOrderBy: AppObserveMetricsListOrderBy
              $logsOrderBy: AppObserveLogsOrderBy
              $spansOrderBy: AppObserveSpanListOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    session(id: $id) {
                      id
                      metrics(first: $first, orderBy: $metricsOrderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          node {
                            id
                            ...AppObserveMetricFragment
                          }
                        }
                      }
                      logs(first: $first, orderBy: $logsOrderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          node {
                            id
                            __typename
                            ... on AppObserveUserEvent {
                              ...AppObserveUserEventFragment
                            }
                            ... on AppObserveError {
                              ...AppObserveErrorFragment
                            }
                          }
                        }
                      }
                      spans(first: $first, orderBy: $spansOrderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          node {
                            id
                            ...AppObserveSpanFragment
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveMetricFragmentNode)}
            ${print(AppObserveUserEventFragmentNode)}
            ${print(AppObserveErrorFragmentNode)}
            ${print(AppObserveSpanFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { metrics, logs, spans } = data.app.byId.observe.session;
    return {
      metrics: metrics.edges.map(edge => edge.node),
      logs: logs.edges.map(edge => edge.node),
      spans: spans.edges.map(edge => edge.node),
      metricsPageInfo: metrics.pageInfo,
      logsPageInfo: logs.pageInfo,
      spansPageInfo: spans.pageInfo,
    };
  },

  async spanListAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveSpanListQueryVariables
  ): Promise<{ spans: AppObserveSpan[]; pageInfo: PageInfo }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveSpanListQuery, AppObserveSpanListQueryVariables>(
          gql`
            query AppObserveSpanList(
              $appId: String!
              $filter: AppObserveSpanListFilter!
              $first: Int
              $after: String
              $orderBy: AppObserveSpanListOrderBy
            ) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    traces {
                      spans(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
                        pageInfo {
                          hasNextPage
                          hasPreviousPage
                          endCursor
                        }
                        edges {
                          cursor
                          node {
                            id
                            ...AppObserveSpanFragment
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveSpanFragmentNode)}
          `,
          variables
        )
        .toPromise()
    );

    const { edges, pageInfo } = data.app.byId.observe.traces.spans;
    return {
      spans: edges.map(edge => edge.node),
      pageInfo,
    };
  },

  async spanNamesAsync(
    graphqlClient: ExpoGraphqlClient,
    variables: AppObserveSpanNamesQueryVariables
  ): Promise<{ names: AppObserveSpanName[]; isTruncated: boolean }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveSpanNamesQuery, AppObserveSpanNamesQueryVariables>(
          gql`
            query AppObserveSpanNames($appId: String!, $input: AppObserveSpanNamesInput!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    traces {
                      names(input: $input) {
                        isTruncated
                        names {
                          name
                          kind
                          count
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

    return data.app.byId.observe.traces.names;
  },

  async traceByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, id }: AppObserveByIdQueryVariables
  ): Promise<AppObserveTrace | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveTraceByIdQuery, AppObserveByIdQueryVariables>(
          gql`
            query AppObserveTraceById($appId: String!, $id: ID!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    traces {
                      trace(id: $id) {
                        id
                        isTruncated
                        spans {
                          id
                          ...AppObserveSpanFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveSpanFragmentNode)}
          `,
          { appId, id }
        )
        .toPromise()
    );

    return data.app.byId.observe.traces.trace ?? null;
  },

  async metricByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, id }: AppObserveByIdQueryVariables
  ): Promise<AppObserveMetric | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveMetricByIdQuery, AppObserveByIdQueryVariables>(
          gql`
            query AppObserveMetricById($appId: String!, $id: ID!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    metrics {
                      metric(id: $id) {
                        id
                        ...AppObserveMetricFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveMetricFragmentNode)}
          `,
          { appId, id }
        )
        .toPromise()
    );

    return data.app.byId.observe.metrics.metric ?? null;
  },

  async logByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, id }: AppObserveByIdQueryVariables
  ): Promise<AppObserveSessionLog | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppObserveLogByIdQuery, AppObserveByIdQueryVariables>(
          gql`
            query AppObserveLogById($appId: String!, $id: ID!) {
              app {
                byId(appId: $appId) {
                  id
                  observe {
                    log(id: $id) {
                      id
                      __typename
                      ... on AppObserveUserEvent {
                        ...AppObserveUserEventFragment
                      }
                      ... on AppObserveError {
                        ...AppObserveErrorFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(AppObserveUserEventFragmentNode)}
            ${print(AppObserveErrorFragmentNode)}
          `,
          { appId, id }
        )
        .toPromise()
    );

    return data.app.byId.observe.log ?? null;
  },
};
