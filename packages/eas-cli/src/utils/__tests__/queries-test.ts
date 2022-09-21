import { confirmAsync, multiselectAsync, selectAsync } from '../../prompts';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithMultiSelectPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../queries';

jest.mock('../../prompts', () => ({
  selectAsync: jest.fn(),
  multiselectAsync: jest.fn(),
  confirmAsync: jest.fn(),
}));

type MockDataType = {
  id: string;
  value: string;
};

const mockQuery = jest.fn<Promise<MockDataType[]>, any>();
const mockRenderMethod = jest.fn();

const selectMoreObject = {
  title: 'Next page...',
  value: '_fetchMore',
};

function createPaginatedQueryResponse(
  responseLength: number,
  uniqueIdentifier?: string,
  firstItem?: MockDataType
): MockDataType[] {
  return Array.from({ length: responseLength }).map((_, index) => {
    return !index && firstItem
      ? firstItem
      : {
          id: `${uniqueIdentifier ?? 'x'}-${index}`,
          value: `${uniqueIdentifier ?? 'x'}-${index}`,
        };
  });
}

describe(paginatedQueryWithConfirmPromptAsync.name, () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockRenderMethod.mockClear();
    jest.mocked(confirmAsync).mockClear();
  });

  it.each([
    [10, 50],
    [77, 30],
  ])(
    'sets the limit to %s + 1 and offset to %s and queries until no results are left',
    async (limit, offset) => {
      mockQuery
        .mockResolvedValueOnce(createPaginatedQueryResponse(limit + 1))
        .mockResolvedValueOnce(createPaginatedQueryResponse(limit + 1))
        .mockResolvedValueOnce(createPaginatedQueryResponse(Math.floor(limit / 2)));
      jest.mocked(confirmAsync).mockResolvedValue(true);

      await paginatedQueryWithConfirmPromptAsync({
        limit,
        offset,
        queryToPerform: mockQuery,
        promptOptions: {
          title: '',
          renderListItems: mockRenderMethod,
        },
      });

      const { calls } = mockQuery.mock;
      const finalResults = await mockQuery.mock.results.pop()?.value;
      expect(mockQuery.mock.calls.length).toEqual(3);
      calls.forEach(([limitArg, offsetArg], i) => {
        expect(limitArg).toEqual(limit + 1);
        expect(offsetArg).toEqual(offset + limit * i);
      });
      expect(finalResults.length).toEqual(Math.floor(limit / 2));
      expect(mockRenderMethod).toBeCalledTimes(3);
    }
  );
});

describe(paginatedQueryWithSelectPromptAsync.name, () => {
  const mockHandleEmptySelectList = jest.fn();

  beforeEach(() => {
    mockQuery.mockClear();
    mockRenderMethod.mockClear();
    mockHandleEmptySelectList.mockClear();
    jest.mocked(selectAsync).mockClear();
  });

  it.each([
    [10, 50],
    [77, 30],
  ])(
    'queries multiple pages of %s + 1 items with an offset of %s and returns the selected list item',
    async (limit, offset) => {
      const selectedItem = {
        title: 'second-3',
        value: 'second-3',
      };
      mockQuery
        .mockResolvedValueOnce(createPaginatedQueryResponse(limit + 1, 'first'))
        // we need to insert the last item from the previous query
        // as the first item in the following query.
        // the id is used for grouping items, so it must match an id in the previous query
        .mockResolvedValueOnce(
          createPaginatedQueryResponse(limit + 1, 'second', {
            id: `first-${limit}`,
            value: `first-${limit}`,
          })
        )
        .mockResolvedValueOnce(
          createPaginatedQueryResponse(Math.floor(limit / 2), 'third', {
            id: `second-${limit}`,
            value: `second-${limit}`,
          })
        );
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce(selectMoreObject.value)
        .mockResolvedValueOnce(selectMoreObject.value)
        .mockResolvedValueOnce(selectedItem.value);

      const selectedQueryItem = await paginatedQueryWithSelectPromptAsync({
        limit,
        offset,
        queryToPerform: mockQuery,
        promptOptions: {
          title: '',
          getIdentifierForQueryItem: item => item.id,
          createDisplayTextForSelectionPromptListItem: jest.fn(),
        },
      });

      expect(selectedQueryItem).toEqual({ id: selectedItem.value, value: selectedItem.value });

      const { calls: queryCalls } = mockQuery.mock;
      const finalQueryResults = await mockQuery.mock.results.pop()?.value;
      expect(mockQuery.mock.calls.length).toEqual(3);
      queryCalls.forEach(([limitArg, offsetArg], i) => {
        expect(limitArg).toEqual(limit + 1);
        expect(offsetArg).toEqual(offset + limit * i);
      });
      expect(finalQueryResults.length).toEqual(Math.floor(limit / 2));

      // select prompt
      const selectCalls = jest.mocked(selectAsync).mock.calls;
      selectCalls.forEach(([, listItems], i) => {
        const oneBasedIndex = i + 1;
        const isLastCall = i === 2;
        if (isLastCall) {
          expect(listItems[listItems.length - 1]).not.toEqual(selectMoreObject);
          expect(listItems.length).toEqual(
            limit * oneBasedIndex -
              // ceiling gives us the extra query item
              // used for pagination in odd limit queries
              Math.ceil(limit / 2)
          );
        } else {
          expect(listItems[listItems.length - 1]).toEqual(selectMoreObject);
          expect(listItems.length).toEqual(
            limit * oneBasedIndex +
              // pagination item
              1
          );
        }
      });
    }
  );

  it('returns nothing when there are no items to select', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await paginatedQueryWithSelectPromptAsync({
      limit: 50,
      offset: 0,
      queryToPerform: mockQuery,
      promptOptions: {
        title: '',
        getIdentifierForQueryItem: item => item.id,
        createDisplayTextForSelectionPromptListItem: item => item.value,
      },
    });

    expect(result).toBeFalsy();
  });
});

describe(paginatedQueryWithMultiSelectPromptAsync.name, () => {
  const mockHandleEmptySelectList = jest.fn();

  beforeEach(() => {
    mockQuery.mockClear();
    mockRenderMethod.mockClear();
    mockHandleEmptySelectList.mockClear();
    jest.mocked(multiselectAsync).mockClear();
  });

  it('carries over user selections to new pages', async () => {
    const selectionStates = [
      ['first-2', 'first-3', selectMoreObject.value],
      ['first-2', 'second-1', selectMoreObject.value],
      ['first-2', 'second-1', 'third-3'],
    ];
    const limit = 5;
    const offset = 0;

    mockQuery
      .mockResolvedValueOnce(createPaginatedQueryResponse(limit + 1, 'first'))
      // we need to insert the last item from the previous query
      // as the first item in the following query.
      // the id is used for grouping items, so it must match an id in the previous query
      .mockResolvedValueOnce(
        createPaginatedQueryResponse(limit + 1, 'second', {
          id: `first-${limit}`,
          value: `first-${limit}`,
        })
      )
      .mockResolvedValueOnce(
        createPaginatedQueryResponse(4, 'third', {
          id: `second-${limit}`,
          value: `second-${limit}`,
        })
      );
    jest
      .mocked(multiselectAsync)
      .mockResolvedValueOnce(selectionStates[0])
      .mockResolvedValueOnce(selectionStates[1])
      .mockResolvedValueOnce(selectionStates[2]);

    const selectedQueryItems = await paginatedQueryWithMultiSelectPromptAsync({
      limit,
      offset,
      queryToPerform: mockQuery,
      promptOptions: {
        title: '',
        getIdentifierForQueryItem: item => item.id,
        createDisplayTextForSelectionPromptListItem: jest.fn(),
      },
    });

    expect(selectedQueryItems).toEqual(
      selectionStates[2].map(selection => ({ id: selection, value: selection }))
    );
  });

  it('does not fetch additional pages when "Next page..." is not selected', async () => {
    const limit = 5;
    const offset = 0;

    mockQuery
      .mockResolvedValueOnce(createPaginatedQueryResponse(limit + 1, 'first'))
      // we need to insert the last item from the previous query
      // as the first item in the following query.
      // the id is used for grouping items, so it must match an id in the previous query
      .mockResolvedValueOnce(
        createPaginatedQueryResponse(limit + 1, 'second', {
          id: `first-${limit}`,
          value: `first-${limit}`,
        })
      );
    jest
      .mocked(multiselectAsync)
      .mockResolvedValueOnce([`first-0`])
      .mockResolvedValueOnce([`Fail this test`]);

    const selectedQueryItems = await paginatedQueryWithMultiSelectPromptAsync({
      limit,
      offset,
      queryToPerform: mockQuery,
      promptOptions: {
        title: '',
        getIdentifierForQueryItem: item => item.id,
        createDisplayTextForSelectionPromptListItem: jest.fn(),
      },
    });

    expect(selectedQueryItems).toEqual([{ id: `first-0`, value: `first-0` }]);
  });
});
