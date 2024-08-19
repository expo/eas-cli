import { PageInfo } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import {
  Connection,
  Edge,
  FilterPagination,
  NEXT_PAGE_OPTION,
  PAGE_SIZE,
  PREV_PAGE_OPTION,
  PaginatedGetterAsync,
  QueryParams,
  fetchEntireDatasetAsync,
  selectPaginatedAsync,
} from '../relay';

jest.mock('../../prompts');
describe(FilterPagination, () => {
  describe(FilterPagination.getPageAsync, () => {
    let queryParams: QueryParams;
    let queryAsync: (queryParams: QueryParams) => Promise<Connection<any>>;
    let filterPredicate: () => boolean;
    let beforeEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[]
    ) => void;
    let afterEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[],
      willFetchAgain: boolean
    ) => void;

    beforeEach(() => {
      queryParams = {};
      queryAsync = jest.fn();
      filterPredicate = jest.fn();
      beforeEachQuery = jest.fn();
      afterEachQuery = jest.fn();
    });

    afterEach(() => {
      jest.resetAllMocks();
      jest.restoreAllMocks();
    });

    test('should call getFirstItemsAsync when isFirstAfter is true', async () => {
      const originalFirstAfter = FilterPagination.isFirstAfter;
      const originalGetFirstItemsAsync = FilterPagination.getFirstItemsAsync;
      FilterPagination.isFirstAfter = jest.fn().mockReturnValue(true) as unknown as (
        connectionArgs: QueryParams
      ) => connectionArgs is {
        first: number;
        after?: string;
      };
      FilterPagination.getFirstItemsAsync = jest.fn().mockResolvedValue({});
      await FilterPagination.getPageAsync({
        queryParams,
        queryAsync,
        filterPredicate,
        beforeEachQuery,
        afterEachQuery,
      });
      expect(FilterPagination.isFirstAfter).toHaveBeenCalledWith(queryParams);
      expect(FilterPagination.getFirstItemsAsync).toHaveBeenCalledWith(
        queryParams,
        expect.any(Object)
      );
      FilterPagination.isFirstAfter = originalFirstAfter;
      FilterPagination.getFirstItemsAsync = originalGetFirstItemsAsync;
    });

    test('should call getLastItemsAsync when isLastBefore is true', async () => {
      const originalIsLastBefore = FilterPagination.isLastBefore;
      const originalGetLastItemsAsync = FilterPagination.getLastItemsAsync;
      FilterPagination.isLastBefore = jest.fn().mockReturnValue(true) as unknown as (
        connectionArgs: QueryParams
      ) => connectionArgs is {
        last: number;
        before?: string;
      };
      FilterPagination.getLastItemsAsync = jest.fn().mockResolvedValue({});
      await FilterPagination.getPageAsync({
        queryParams,
        queryAsync,
        filterPredicate,
        beforeEachQuery,
        afterEachQuery,
      });
      expect(FilterPagination.isLastBefore).toHaveBeenCalledWith(queryParams);
      expect(FilterPagination.getLastItemsAsync).toHaveBeenCalledWith(
        queryParams,
        expect.any(Object)
      );
      FilterPagination.isLastBefore = originalIsLastBefore;
      FilterPagination.getLastItemsAsync = originalGetLastItemsAsync;
    });

    test('should throw an error for invalid query params', async () => {
      const originalIsFirstAfter = FilterPagination.isFirstAfter;
      const originalIsLastBefore = FilterPagination.isLastBefore;
      FilterPagination.isFirstAfter = jest.fn().mockReturnValue(false) as unknown as (
        connectionArgs: QueryParams
      ) => connectionArgs is {
        first: number;
        after?: string;
      };
      FilterPagination.isLastBefore = jest.fn().mockReturnValue(false) as unknown as (
        connectionArgs: QueryParams
      ) => connectionArgs is {
        last: number;
        before?: string;
      };
      await expect(
        FilterPagination.getPageAsync({
          queryParams,
          queryAsync,
          filterPredicate,
          beforeEachQuery,
          afterEachQuery,
        })
      ).rejects.toThrowError('Invalid query params');
      FilterPagination.isFirstAfter = originalIsFirstAfter;
      FilterPagination.isLastBefore = originalIsLastBefore;
    });
  });

  describe(FilterPagination.isFirstAfter, () => {
    test('should return true for object with first property', () => {
      const connectionArgs = { first: 10 };
      expect(FilterPagination.isFirstAfter(connectionArgs)).toBe(true);
    });

    test('should return false for object without first property', () => {
      const connectionArgs = { last: 10 };
      expect(FilterPagination.isFirstAfter(connectionArgs)).toBe(false);
    });
  });

  describe(FilterPagination.isLastBefore, () => {
    test('should return true for object with last property', () => {
      const connectionArgs = { last: 10 };
      expect(FilterPagination.isLastBefore(connectionArgs)).toBe(true);
    });

    test('should return false for object without last property', () => {
      const connectionArgs = { first: 10 };
      expect(FilterPagination.isLastBefore(connectionArgs)).toBe(false);
    });
  });

  describe(FilterPagination.getFirstItemsAsync, () => {
    let queryArgs: {
      first: number;
      after?: string | undefined;
    };
    let internalBatchSize: number;
    let maxNodesFetched: number;
    let filterPredicate: () => boolean;
    let queryAsync: (queryParams: QueryParams) => Promise<Connection<any>>;
    let beforeEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[]
    ) => void;
    let afterEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[],
      willFetchAgain: boolean
    ) => void;

    beforeEach(() => {
      queryArgs = { first: 10, after: 'cursor' };
      internalBatchSize = 100;
      maxNodesFetched = 10000;
      filterPredicate = jest.fn();
      queryAsync = jest.fn();
      beforeEachQuery = jest.fn();
      afterEachQuery = jest.fn();
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    test('should call queryAsync with internalBatchSize and after', async () => {
      const pageInfo = { hasNextPage: false };
      const result = { edges: [], pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(queryAsync).toHaveBeenCalledWith({ first: internalBatchSize, after: queryArgs.after });
    });
    test('should call filterPredicate for each batch edge', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [{ node: 'node1' }, { node: 'node2' }, { node: 'node3' }];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(filterPredicate).toHaveBeenCalledTimes(edges.length);
      expect(filterPredicate).toHaveBeenCalledWith(edges[0].node);
      expect(filterPredicate).toHaveBeenCalledWith(edges[1].node);
      expect(filterPredicate).toHaveBeenCalledWith(edges[2].node);
    });
    test('should append batch edges to the dataset', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      const connection = await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(connection.edges).toEqual(edges);
    });
    test('should stop appending batch edges when dataset reaches limit', async () => {
      const pageInfo = { hasNextPage: true };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
        { node: 'node3', cursor: 'cursor3' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      const limit = 1;
      const connection = await FilterPagination.getFirstItemsAsync(
        { first: limit },
        {
          internalBatchSize,
          maxNodesFetched,
          filterPredicate,
          queryAsync,
          beforeEachQuery,
          afterEachQuery,
        }
      );

      expect(connection.edges.length).toBe(limit);
      expect(connection.edges).toEqual([edges[0]]);
    });
    test('should call beforeEachQuery before each query', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });
      expect(beforeEachQuery).toHaveBeenCalled();
    });
    test('should call afterEachQuery after each query', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(afterEachQuery).toHaveBeenCalled();
    });
    test('should pass the correct arguments to beforeEachQuery', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(beforeEachQuery).toHaveBeenCalledWith(queryArgs, 0, expect.any(Array));
    });
    test('should pass the correct arguments to afterEachQuery', async () => {
      const pageInfo = { hasNextPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getFirstItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(afterEachQuery).toHaveBeenCalledWith(
        queryArgs,
        edges.length,
        expect.any(Array),
        pageInfo.hasNextPage
      );
    });
    test('should throw an error when maxNodesFetched is exceeded', async () => {
      const pageInfo = { hasNextPage: true };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      maxNodesFetched = edges.length;
      await expect(
        FilterPagination.getFirstItemsAsync(queryArgs, {
          internalBatchSize,
          maxNodesFetched,
          filterPredicate,
          queryAsync,
          beforeEachQuery,
          afterEachQuery,
        })
      ).rejects.toThrowError(`Max nodes of ${maxNodesFetched} fetched`);
    });
  });
  describe(FilterPagination.getLastItemsAsync, () => {
    let queryArgs: {
      last: number;
      before?: string | undefined;
    };
    let internalBatchSize: number;
    let maxNodesFetched: number;
    let filterPredicate: () => boolean;
    let queryAsync: (queryParams: QueryParams) => Promise<Connection<any>>;
    let beforeEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[]
    ) => void;
    let afterEachQuery: (
      externalQueryParams: QueryParams,
      totalNodesFetched: number,
      dataset: any[],
      willFetchAgain: boolean
    ) => void;

    beforeEach(() => {
      queryArgs = { last: 10, before: 'cursor' };
      internalBatchSize = 100;
      maxNodesFetched = 10000;
      filterPredicate = jest.fn();
      queryAsync = jest.fn();
      beforeEachQuery = jest.fn();
      afterEachQuery = jest.fn();
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    test('should call queryAsync with internalBatchSize and after', async () => {
      const pageInfo = { hasPreviousPage: false };
      const result = { edges: [], pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(queryAsync).toHaveBeenCalledWith({
        last: internalBatchSize,
        before: queryArgs.before,
      });
    });
    test('should call filterPredicate for each batch edge', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [{ node: 'node1' }, { node: 'node2' }, { node: 'node3' }];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(filterPredicate).toHaveBeenCalledTimes(edges.length);
      expect(filterPredicate).toHaveBeenCalledWith(edges[0].node);
      expect(filterPredicate).toHaveBeenCalledWith(edges[1].node);
      expect(filterPredicate).toHaveBeenCalledWith(edges[2].node);
    });
    test('should append batch edges to the dataset', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      const connection = await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(connection.edges).toEqual(edges);
    });
    test('should stop appending batch edges when dataset reaches limit', async () => {
      const pageInfo = { hasPreviousPage: true };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
        { node: 'node3', cursor: 'cursor3' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);
      (filterPredicate as jest.Mock).mockResolvedValue(true);

      const limit = 1;
      const connection = await FilterPagination.getLastItemsAsync(
        { last: limit },
        {
          internalBatchSize,
          maxNodesFetched,
          filterPredicate,
          queryAsync,
          beforeEachQuery,
          afterEachQuery,
        }
      );

      expect(connection.edges.length).toBe(limit);
      expect(connection.edges).toEqual([edges[2]]);
    });
    test('should call beforeEachQuery before each query', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });
      expect(beforeEachQuery).toHaveBeenCalled();
    });
    test('should call afterEachQuery after each query', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(afterEachQuery).toHaveBeenCalled();
    });
    test('should pass the correct arguments to beforeEachQuery', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(beforeEachQuery).toHaveBeenCalledWith(queryArgs, 0, expect.any(Array));
    });
    test('should pass the correct arguments to afterEachQuery', async () => {
      const pageInfo = { hasPreviousPage: false };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      await FilterPagination.getLastItemsAsync(queryArgs, {
        internalBatchSize,
        maxNodesFetched,
        filterPredicate,
        queryAsync,
        beforeEachQuery,
        afterEachQuery,
      });

      expect(afterEachQuery).toHaveBeenCalledWith(
        queryArgs,
        edges.length,
        expect.any(Array),
        pageInfo.hasPreviousPage
      );
    });
    test('should throw an error when maxNodesFetched is exceeded', async () => {
      const pageInfo = { hasPreviousPage: true };
      const edges = [
        { node: 'node1', cursor: 'cursor1' },
        { node: 'node2', cursor: 'cursor2' },
      ];
      const result = { edges, pageInfo };
      (queryAsync as jest.Mock).mockResolvedValue(result);

      maxNodesFetched = edges.length;
      await expect(
        FilterPagination.getLastItemsAsync(queryArgs, {
          internalBatchSize,
          maxNodesFetched,
          filterPredicate,
          queryAsync,
          beforeEachQuery,
          afterEachQuery,
        })
      ).rejects.toThrowError(`Max nodes of ${maxNodesFetched} fetched`);
    });
  });
});

describe(selectPaginatedAsync, () => {
  const queryAsync = jest.fn();
  const getTitleAsync = jest.fn();
  const printedType = 'Node';
  const pageSize = 10;

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns null when there are no items', async () => {
    queryAsync.mockResolvedValueOnce({
      edges: [],
    });

    const result = await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });

    expect(result).toBeNull();
    expect(queryAsync).toHaveBeenCalledWith({ first: pageSize });
  });

  test('still prompts if there is only one item avaiable', async () => {
    const node = { id: '1', name: 'Node 1' };
    queryAsync.mockResolvedValueOnce({
      edges: [{ node }],
      pageInfo: { hasNextPage: false },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: node,
    }));

    const result = await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });

    expect(result).toEqual(node);
    expect(queryAsync).toHaveBeenCalledWith({
      first: pageSize,
    });
    expect(promptAsync).toBeCalledTimes(1);
  });

  test('prompts for selection when there are multiple items', async () => {
    const node1 = { id: '1', name: 'Node 1' };
    const node2 = { id: '2', name: 'Node 2' };
    queryAsync.mockResolvedValue({
      edges: [{ node: node1 }, { node: node2 }],
      pageInfo: { hasNextPage: false },
    });
    getTitleAsync.mockResolvedValueOnce('Node 1');
    getTitleAsync.mockResolvedValueOnce('Node 2');
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: node1,
    }));

    const result = await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });

    expect(result).toEqual(node1);
    expect(queryAsync).toHaveBeenCalledWith({ first: pageSize });
    expect(getTitleAsync).toHaveBeenCalledWith(node1);
    expect(getTitleAsync).toHaveBeenCalledWith(node2);
  });

  test('selects the previous page', async () => {
    const node1 = { id: '1', name: 'Node 1' };
    const node2 = { id: '2', name: 'Node 2' };
    const node3 = { id: '3', name: 'Node 3' };

    queryAsync.mockResolvedValueOnce({
      edges: [{ node: node1 }, { node: node2 }],
      pageInfo: {
        endCursor: 'endCursor',
        hasNextPage: true,
      },
    });

    queryAsync.mockResolvedValueOnce({
      edges: [{ node: node3 }],
      pageInfo: {
        startCursor: 'startCursor',
        hasPreviousPage: true,
      },
    });

    getTitleAsync.mockResolvedValueOnce('Node 1');
    getTitleAsync.mockResolvedValueOnce('Node 2');
    getTitleAsync.mockResolvedValueOnce('Node 3');

    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      item: NEXT_PAGE_OPTION.value,
    }));
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      item: PREV_PAGE_OPTION.value,
    }));
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      item: node1,
    }));

    const result = await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });

    expect(result).toEqual(node1);
    expect(queryAsync).toHaveBeenCalledWith({ first: pageSize });
    expect(queryAsync).toHaveBeenCalledWith({
      last: pageSize,
      before: 'startCursor',
    });
    expect(getTitleAsync).toHaveBeenCalledWith(node1);
    expect(getTitleAsync).toHaveBeenCalledWith(node2);
    expect(getTitleAsync).toHaveBeenCalledWith(node3);
  });

  test('selects the next page', async () => {
    const node1 = { id: '1', name: 'Node 1' };
    const node2 = { id: '2', name: 'Node 2' };
    const node3 = { id: '3', name: 'Node 3' };

    queryAsync.mockResolvedValueOnce({
      edges: [{ node: node1 }, { node: node2 }],
      pageInfo: {
        endCursor: 'endCursor',
        hasNextPage: true,
      },
    });

    queryAsync.mockResolvedValueOnce({
      edges: [{ node: node3 }],
      pageInfo: {
        startCursor: 'startCursor',
        hasPreviousPage: true,
      },
    });

    getTitleAsync.mockResolvedValueOnce('Node 1');
    getTitleAsync.mockResolvedValueOnce('Node 2');
    getTitleAsync.mockResolvedValueOnce('Node 3');

    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      item: NEXT_PAGE_OPTION.value,
    }));
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      item: node3,
    }));

    const result = await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });

    expect(result).toEqual(node3);
    expect(queryAsync).toHaveBeenCalledWith({ first: pageSize });
    expect(queryAsync).toHaveBeenCalledWith({
      first: pageSize,
      after: 'endCursor',
    });
    expect(getTitleAsync).toHaveBeenCalledWith(node1);
    expect(getTitleAsync).toHaveBeenCalledWith(node2);
    expect(getTitleAsync).toHaveBeenCalledWith(node3);
  });
});

describe(selectPaginatedAsync, () => {
  const mockDataset = Array.from({ length: 50 }, (_, idx) => ({ id: idx + 1 }));
  const testPaginatedGetterAsync: PaginatedGetterAsync<object> = async (
    relayArgs: QueryParams
  ): Promise<Connection<object>> => {
    const startIdx = relayArgs.after ? Number(relayArgs.after) : 0;
    const endIdx = startIdx + (relayArgs.first || PAGE_SIZE);
    const hasNextPage = endIdx < mockDataset.length;
    const hasPreviousPage = startIdx > 0;
    const edges: Edge<object>[] = mockDataset
      .slice(startIdx, endIdx)
      .map(node => ({ cursor: String(node.id), node }));

    const pageInfo: PageInfo = {
      hasNextPage,
      hasPreviousPage,
      endCursor: hasNextPage ? String(endIdx) : undefined,
    };

    return {
      edges,
      pageInfo,
    };
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getting an entire paginated dataset', async () => {
    const data = await fetchEntireDatasetAsync({
      paginatedGetterAsync: testPaginatedGetterAsync,
    });
    expect(data).toEqual(mockDataset);
  });
  test('getting an empty paginated dataset', async () => {
    const emptyPaginatedGetterAsync = async (): Promise<Connection<object>> => {
      return {
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    };
    const data = await fetchEntireDatasetAsync({
      paginatedGetterAsync: emptyPaginatedGetterAsync,
    });
    expect(data).toEqual([]);
  });
});
