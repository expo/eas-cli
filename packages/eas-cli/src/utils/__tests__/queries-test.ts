import { confirmAsync } from '../../prompts';
import {
  PaginatedQueryPromptType,
  PaginatedQueryResponse,
  //   PaginatedQueryResponse,
  performPaginatedQueryAsync,
} from '../queries';
// const queryResolution = jest.fn(
//   (): PaginatedQueryResponse<any> => ({
//     queryResponse: [1],
//     queryResponseRawLength: 1,
//   })
// );

jest.mock('../../prompts', () => ({
  selectAsync: jest.fn(),
  confirmAsync: jest.fn(),
}));

const mockQuery = jest.fn();

function createPaginatedQueryResponse(responseLength: number): PaginatedQueryResponse<any> {
  return {
    queryResponse: Array.from({ length: responseLength }).fill(0),
    queryResponseRawLength: responseLength,
  };
}

describe(performPaginatedQueryAsync.name, () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });
  it.each([
    [10, 50],
    [77, 30],
  ])(
    'sets the limit to %s and offset to %s and queries until no results are left',
    async (limit, offset) => {
      mockQuery
        .mockReturnValueOnce(createPaginatedQueryResponse(limit + 1))
        .mockReturnValueOnce(createPaginatedQueryResponse(limit + 1))
        .mockResolvedValueOnce(createPaginatedQueryResponse(Math.floor(limit / 2)));
      jest.mocked(confirmAsync).mockResolvedValue(true);
      await performPaginatedQueryAsync({
        pageSize: limit,
        offset,
        queryToPerform: mockQuery,
        promptOptions: {
          type: PaginatedQueryPromptType.confirm,
          title: '',
          renderListItems: jest.fn(),
        },
      });
      const { calls } = mockQuery.mock;
      const finalResults = await mockQuery.mock.results.pop()?.value;

      expect(mockQuery.mock.calls.length).toEqual(3);
      calls.forEach(([limitArg, offsetArg], i) => {
        expect(limitArg).toEqual(limit + 1);
        expect(offsetArg).toEqual(offset + limit * i);
      });
      expect(finalResults.queryResponseRawLength).toEqual(Math.floor(limit / 2));
    }
  );
});
