import { getPaginatedDatasetAsync } from '../relay';

describe('getPaginatedDatasetAsync', () => {
  const mockQueryAsync = jest.fn(({ first, after }) =>
    Promise.resolve({
      edges: Array(first).fill({ node: 'node', cursor: 'cursor' }),
      pageInfo: {
        hasNextPage: after !== 'next',
        endCursor: after ? null : 'next',
        hasPreviousPage: false,
      },
    })
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should query data page by page until no more data', async () => {
    const dataset = await getPaginatedDatasetAsync({
      queryAsync: mockQueryAsync,
      batchSize: 1,
    });

    expect(mockQueryAsync).toHaveBeenCalledTimes(2);
    expect(mockQueryAsync).toHaveBeenCalledWith({ first: 1, after: undefined });
    expect(mockQueryAsync).toHaveBeenCalledWith({ first: 1, after: 'next' });
    expect(dataset).toHaveLength(2);
  });

  it('should call beforeEachQuery and afterEachQuery with correct parameters', async () => {
    // dataset is pass by reference, so we make a copy at each call
    const datasetAtNthCall_beforeEachQuery = [] as any;
    const mockBeforeEachQuery = jest.fn((totalNodesFetched, dataset) => {
      datasetAtNthCall_beforeEachQuery.push([...dataset]);
    });

    // dataset is pass by reference, so we make a copy at each call
    const datasetAtNthCall_afterEachQuery = [] as any;
    const mockAfterEachQuery = jest.fn((totalNodesFetched, dataset, batch, pageInfo) => {
      datasetAtNthCall_afterEachQuery.push([...dataset]);
    });

    await getPaginatedDatasetAsync({
      queryAsync: mockQueryAsync,
      beforeEachQuery: mockBeforeEachQuery,
      afterEachQuery: mockAfterEachQuery,
      batchSize: 1,
    });

    expect(mockBeforeEachQuery).toHaveBeenCalledTimes(2);
    expect(mockBeforeEachQuery).toHaveBeenNthCalledWith(1, 0, expect.any(Array));
    expect(datasetAtNthCall_beforeEachQuery[0]).toStrictEqual([]);
    expect(mockBeforeEachQuery).toHaveBeenNthCalledWith(2, 1, expect.any(Array));
    expect(datasetAtNthCall_beforeEachQuery[1]).toStrictEqual(['node']);

    expect(mockAfterEachQuery).toHaveBeenCalledTimes(2);
    expect(mockAfterEachQuery).toHaveBeenNthCalledWith(1, 1, expect.any(Array), ['node'], {
      hasNextPage: true,
      endCursor: 'next',
      hasPreviousPage: false,
    });
    expect(datasetAtNthCall_afterEachQuery[0]).toStrictEqual(['node']);
    expect(mockAfterEachQuery).toHaveBeenNthCalledWith(2, 2, expect.any(Array), ['node'], {
      hasNextPage: false,
      endCursor: null,
      hasPreviousPage: false,
    });
    expect(datasetAtNthCall_afterEachQuery[1]).toStrictEqual(['node', 'node']);
  });

  it('should filter nodes if filterPredicate is provided', async () => {
    const filterPredicate = (node: string): boolean => node !== 'node';

    const dataset = await getPaginatedDatasetAsync({
      queryAsync: mockQueryAsync,
      filterPredicate,
      batchSize: 1,
    });

    expect(dataset).toEqual([]); // expecting an empty array because our filterPredicate will filter out 'node'
  });

  it('should stop fetching when maxNodesFetched limit is reached', async () => {
    const dataset = await getPaginatedDatasetAsync({
      queryAsync: mockQueryAsync,
      batchSize: 2,
      maxNodesFetched: 2,
    });

    expect(dataset).toHaveLength(2);
    expect(mockQueryAsync).toHaveBeenCalledTimes(1);
  });
});
