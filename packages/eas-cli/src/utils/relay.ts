import { PageInfo } from '../graphql/generated';

export type Connection<T> = {
  edges: Edge<T>[];
  pageInfo: PageInfo;
};

type Edge<T> = {
  node: T;
};

export type QueryParams = {
  first: number;
  after?: string;
};

/**
 * Fetches dataset in paginated manner (batch by batch) using GraphQL queries.
 *
 * @param queryAsync A promise based function for querying.
 * @param beforeEachQuery Optional. A callback function to be called before each query
 * @param afterEachQuery Optional. A callback function to be called after each query.
 * @param filterPredicate Optional. A predicate function to filter the node.
 * @param batchSize Optional. The batch size of the pagination. Defaults to 100.
 *
 * @return {Promise<T[]>} - A promise that resolves to an array (the dataset).
 * @throws {Error} - If an error occurs during execution of the query or pagination.
 */
export async function getPaginatedDatasetAsync<T>({
  queryAsync,
  beforeEachQuery,
  afterEachQuery,
  filterPredicate,
  batchSize = 100,
  maxNodesFetched = 10_000,
}: {
  queryAsync: ({ first, after }: QueryParams) => Promise<Connection<T>>;
  beforeEachQuery?: (totalNodesFetched: number, dataset: T[]) => void;
  afterEachQuery?: (
    totalNodesFetched: number,
    dataset: T[],
    batch: T[],
    pageInfo: PageInfo
  ) => void;
  filterPredicate?: (node: T) => boolean;
  batchSize?: number;
  maxNodesFetched?: number;
}): Promise<T[]> {
  const dataset = [];
  let hasMore = true;
  let after: string | undefined;
  let totalNodesFetched = 0;
  while (hasMore) {
    if (beforeEachQuery) {
      beforeEachQuery(totalNodesFetched, dataset);
    }
    const result = await queryAsync({ first: batchSize, after });
    const { edges, pageInfo } = result;
    const nodes = edges.map(edge => edge.node);
    const batch = filterPredicate ? nodes.filter(filterPredicate) : nodes;
    dataset.push(...batch);
    hasMore = pageInfo.hasNextPage;
    after = pageInfo.endCursor ?? undefined;
    totalNodesFetched += nodes.length;
    if (afterEachQuery) {
      afterEachQuery(totalNodesFetched, dataset, batch, pageInfo);
    }
    if (totalNodesFetched >= maxNodesFetched) {
      return dataset;
    }
  }
  return dataset;
}
