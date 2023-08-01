import assert from 'assert';

import { PageInfo } from '../graphql/generated';
import { promptAsync } from '../prompts';

export type Connection<T> = {
  edges: Edge<T>[];
  pageInfo: PageInfo;
};

type Edge<T> = {
  cursor: string;
  node: T;
};

export type QueryParams = {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
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
      throw new Error(`Max nodes of ${maxNodesFetched} fetched`);
    }
  }
  return dataset;
}

/**
 *
 * Pagination that performs client side filtering on the nodes returned from a relay compliant datasource.
 *
 * @param queryParams The query params for the pagination.
 * @param queryAsync A promise based function for querying.
 * @param filterPredicate A predicate function to filter the node.
 * @param beforeEachQuery Optional. A callback function to be called before each query
 * @param afterEachQuery Optional. A callback function to be called after each query.
 * @param internalBatchSize Optional. The batch size of queryAsync. Defaults to 100.
 * @param maxNodesFetched Optional. The maximum number of nodes to fetch. Defaults to 10_000.
 *
 * @throws {Error} - If an error occurs during execution of the query or pagination.
 */
export class FilterPagination {
  async getPageAsync<T>({
    queryParams,
    queryAsync,
    filterPredicate,
    internalBatchSize = 100,
    maxNodesFetched = 10_000,
  }: {
    queryParams: QueryParams;
    queryAsync: (queryParams: QueryParams) => Promise<Connection<T>>;
    filterPredicate: (node: T) => boolean;
    internalBatchSize?: number;
    maxNodesFetched?: number;
  }): Promise<Connection<T>> {
    if (this.isFirstAfter(queryParams)) {
      return await this.getFirstItemsAsync(queryParams, {
        queryAsync,
        filterPredicate,
        internalBatchSize,
        maxNodesFetched,
      });
    } else if (this.isLastBefore(queryParams)) {
      return await this.getLastItemsAsync(queryParams, {
        queryAsync,
        filterPredicate,
        internalBatchSize,
        maxNodesFetched,
      });
    }
    throw new Error('Invalid query params');
  }

  isFirstAfter(connectionArgs: {
    first?: number;
    after?: string;
    last?: number;
    before?: string;
  }): connectionArgs is {
    first: number;
    after?: string;
  } {
    return 'first' in connectionArgs;
  }

  isLastBefore(connectionArgs: {
    first?: number;
    after?: string;
    last?: number;
    before?: string;
  }): connectionArgs is {
    last: number;
    before?: string;
  } {
    return 'last' in connectionArgs;
  }

  async getFirstItemsAsync<T>(
    { first, after }: { first: number; after?: string },
    {
      internalBatchSize,
      maxNodesFetched,
      filterPredicate,
      queryAsync,
    }: {
      internalBatchSize?: number;
      maxNodesFetched: number;
      filterPredicate: (node: T) => boolean;
      queryAsync: (queryParams: QueryParams) => Promise<Connection<T>>;
    }
  ): Promise<Connection<T>> {
    const limit = first + 1;
    const dataset = [] as Edge<T>[];
    let hasMore = true;
    let afterInternal: string | undefined = after;
    let totalNodesFetched = 0;
    while (hasMore && dataset.length < limit) {
      const result = await queryAsync({ first: internalBatchSize, after: afterInternal });
      const { edges: batchEdges, pageInfo } = result;
      const batch = batchEdges.filter(edge => filterPredicate(edge.node));
      const nodesRemaining = limit - dataset.length;
      dataset.push(...batch.slice(0, nodesRemaining));
      hasMore = pageInfo.hasNextPage;
      afterInternal = pageInfo.endCursor ?? undefined;
      totalNodesFetched += batchEdges.length;
      if (totalNodesFetched >= maxNodesFetched) {
        throw new Error(`Max nodes of ${maxNodesFetched} fetched`);
      }
    }
    const edges = dataset.slice(0, first);
    return {
      edges,
      pageInfo: {
        hasNextPage: dataset.length > first,
        hasPreviousPage: false, // cannot be computed efficiently
        startCursor: edges.at(0)?.cursor ?? null,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }

  async getLastItemsAsync<T>(
    { last, before }: { last: number; before?: string },
    {
      internalBatchSize,
      maxNodesFetched,
      filterPredicate,
      queryAsync,
    }: {
      internalBatchSize?: number;
      maxNodesFetched: number;
      filterPredicate: (node: T) => boolean;
      queryAsync: (queryParams: QueryParams) => Promise<Connection<T>>;
    }
  ): Promise<Connection<T>> {
    const limit = last + 1;
    const dataset = [] as Edge<T>[];
    let hasMore = true;
    let beforeInternal: string | undefined = before;
    let totalNodesFetched = 0;
    while (hasMore && dataset.length < limit) {
      const result = await queryAsync({ last: internalBatchSize, before: beforeInternal });
      const { edges: batchEdges, pageInfo } = result;
      const batch = batchEdges.filter(edge => filterPredicate(edge.node));
      const nodesRemaining = limit - dataset.length;
      // relay orders pages from first to last, so we reverse the batch to to choose the last n
      const nodesChosen = batch.reverse().slice(0, nodesRemaining);
      dataset.push(...nodesChosen);
      hasMore = pageInfo.hasPreviousPage;
      beforeInternal = pageInfo.startCursor ?? undefined;
      totalNodesFetched += batchEdges.length;
      if (totalNodesFetched >= maxNodesFetched) {
        throw new Error(`Max nodes of ${maxNodesFetched} fetched`);
      }
    }
    // we reverse our dataset again to restore the original order of first to last to match relay
    const edges = dataset.slice(0, last).reverse();
    return {
      edges,
      pageInfo: {
        hasNextPage: false, // cannot be computed efficiently,
        hasPreviousPage: dataset.length > last,
        startCursor: edges.at(0)?.cursor ?? null,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }
}

export async function selectPaginatedAsync<T>({
  queryAsync,
  getTitleAsync,
  printedType,
  pageSize,
}: {
  pageSize: number;
  queryAsync: (queryParams: QueryParams) => Promise<Connection<T>>;
  getTitleAsync: (node: T) => Promise<string>;
  printedType: string;
}): Promise<T | null> {
  // Dont bother prompting if there are 0 or 1 items
  const connectionPreflight = await queryAsync({ first: pageSize });
  const { edges } = connectionPreflight;
  if (edges.length === 0) {
    return null;
  } else if (edges.length === 1) {
    return edges[0].node;
  }
  return await selectPaginatedInternalAsync({
    queryAsync,
    getTitleAsync,
    printedType,
    queryParams: { first: pageSize },
  });
}

const PREV_PAGE_OPTION = {
  value: Symbol('PREV_PAGE'),
  title: '⬆️ Previous page',
};
const NEXT_PAGE_OPTION = {
  value: Symbol('NEXT_PAGE'),
  title: '⬇️ Next page',
};
async function selectPaginatedInternalAsync<T>({
  queryAsync,
  getTitleAsync,
  printedType,
  queryParams,
}: {
  queryParams: QueryParams;
  queryAsync: (queryParams: QueryParams) => Promise<Connection<T>>;
  getTitleAsync: (node: T) => Promise<string>;
  printedType: string;
}): Promise<T> {
  const limit = queryParams.first ?? queryParams.last;
  assert(limit, 'queryParams must have either first or last');
  const connection = await queryAsync(queryParams);
  const { edges, pageInfo } = connection;
  const { endCursor, hasNextPage, startCursor, hasPreviousPage } = pageInfo;
  const nodes = edges.map(edge => edge.node);
  const options: { value: symbol | T; title: string }[] = [];
  if (hasPreviousPage) {
    options.push(PREV_PAGE_OPTION);
  }
  const nodeTitles = await Promise.all(nodes.map(node => getTitleAsync(node)));
  options.push(...nodes.map((node, index) => ({ value: node, title: nodeTitles[index] })));
  if (hasNextPage) {
    options.push(NEXT_PAGE_OPTION);
  }
  const { item: selectedItem } = await promptAsync({
    type: 'select',
    name: 'item',
    message: `Select a ${printedType}`,
    choices: options.map(option => ({
      value: option.value,
      title: option.title,
    })),
  });

  if (selectedItem === PREV_PAGE_OPTION.value) {
    return await selectPaginatedInternalAsync({
      queryParams: {
        last: limit,
        before: startCursor ?? undefined,
      },
      queryAsync,
      getTitleAsync,
      printedType,
    });
  } else if (selectedItem === NEXT_PAGE_OPTION.value) {
    return await selectPaginatedInternalAsync({
      queryParams: {
        first: limit,
        after: endCursor ?? undefined,
      },
      queryAsync,
      getTitleAsync,
      printedType,
    });
  } else {
    return selectedItem as T;
  }
}
