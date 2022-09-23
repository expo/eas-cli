import { ExpoChoice, confirmAsync, multiselectAsync, selectAsync } from '../prompts';
import uniqBy from './expodash/uniqBy';
import { PAGINATION_FETCH_MORE_VALUE } from './queryConstants';

type BasePaginatedQueryArgs<QueryReturnType extends Record<string, any>> = {
  limit: number;
  offset: number;
  queryToPerform: (limit: number, offset: number) => Promise<QueryReturnType[]>;
};

type PaginatedQueryWithConfirmPromptArgs<QueryReturnType extends Record<string, any>> =
  BasePaginatedQueryArgs<QueryReturnType> & {
    promptOptions: {
      readonly title: string;
      renderListItems: (currentPage: QueryReturnType[]) => void;
    };
  };

type PaginatedQueryWithSelectPromptArgs<QueryReturnType extends Record<string, any>> =
  BasePaginatedQueryArgs<QueryReturnType> & {
    promptOptions: {
      readonly title: string;
      createDisplayTextForSelectionPromptListItem: (queryItem: QueryReturnType) => string;
      getIdentifierForQueryItem: (queryItem: QueryReturnType) => string;
    };
  };

export async function paginatedQueryWithConfirmPromptAsync<
  QueryReturnType extends Record<string, any>
>(queryArgs: PaginatedQueryWithConfirmPromptArgs<QueryReturnType>): Promise<void> {
  return await paginatedQueryWithConfirmPromptInternalAsync(queryArgs, []);
}

async function paginatedQueryWithConfirmPromptInternalAsync<
  QueryReturnType extends Record<string, any>
>(
  {
    limit,
    offset,
    queryToPerform,
    promptOptions,
  }: PaginatedQueryWithConfirmPromptArgs<QueryReturnType>,
  accumulator: QueryReturnType[]
): Promise<void> {
  // query an extra item to determine if there are more pages left
  const paginatedItems = await queryToPerform(limit + 1, offset);
  const areMorePagesAvailable = paginatedItems.length > limit;
  // drop that extra item used for pagination from our render logic
  const currentPage = paginatedItems.slice(0, limit);
  const newAccumulator = [...accumulator, ...currentPage];

  promptOptions.renderListItems(currentPage);

  if (!areMorePagesAvailable) {
    return;
  }

  if (await confirmAsync({ message: promptOptions.title })) {
    return await paginatedQueryWithConfirmPromptInternalAsync(
      {
        limit,
        offset: offset + limit,
        queryToPerform,
        promptOptions,
      },
      newAccumulator
    );
  }
}

export async function paginatedQueryWithSelectPromptAsync<
  QueryReturnType extends Record<string, any>
>(queryArgs: PaginatedQueryWithSelectPromptArgs<QueryReturnType>): Promise<QueryReturnType | void> {
  return await paginatedQueryWithSelectPromptInternalAsync(queryArgs, []);
}

async function paginatedQueryWithSelectPromptInternalAsync<
  QueryReturnType extends Record<string, any>
>(
  {
    limit,
    offset,
    queryToPerform,
    promptOptions,
  }: PaginatedQueryWithSelectPromptArgs<QueryReturnType>,
  accumulator: QueryReturnType[]
): Promise<QueryReturnType | void> {
  // query an extra item to determine if there are more pages left
  const paginatedItems = await queryToPerform(limit + 1, offset);
  const areMorePagesAvailable = paginatedItems.length > limit;
  // drop that extra item used for pagination from our render logic
  const currentPage = paginatedItems.slice(0, limit);
  const newAccumulator = [...accumulator, ...currentPage];

  const selectionPromptListItems = uniqBy(newAccumulator, queryItem =>
    promptOptions.getIdentifierForQueryItem(queryItem)
  ).map<ExpoChoice<string>>(queryItem => ({
    title: promptOptions.createDisplayTextForSelectionPromptListItem(queryItem),
    value: promptOptions.getIdentifierForQueryItem(queryItem),
  }));
  if (areMorePagesAvailable) {
    selectionPromptListItems.push({ title: 'Next page...', value: PAGINATION_FETCH_MORE_VALUE });
  }
  if (selectionPromptListItems.length === 0) {
    return;
  }

  const valueOfUserSelectedListItem = await selectAsync(
    promptOptions.title,
    selectionPromptListItems
  );

  if (valueOfUserSelectedListItem === PAGINATION_FETCH_MORE_VALUE) {
    return await paginatedQueryWithSelectPromptInternalAsync(
      {
        limit,
        offset: offset + limit,
        queryToPerform,
        promptOptions,
      },
      newAccumulator
    );
  }

  return newAccumulator.find(
    items => promptOptions.getIdentifierForQueryItem(items) === valueOfUserSelectedListItem
  );
}

export async function paginatedQueryWithMultiSelectPromptAsync<
  QueryReturnType extends Record<string, any>
>(
  queryArgs: PaginatedQueryWithSelectPromptArgs<QueryReturnType>
): Promise<QueryReturnType[] | void> {
  return await paginatedQueryWithMultiSelectPromptInternalAsync(queryArgs, [], []);
}

async function paginatedQueryWithMultiSelectPromptInternalAsync<
  QueryReturnType extends Record<string, any>
>(
  {
    limit,
    offset,
    queryToPerform,
    promptOptions,
  }: PaginatedQueryWithSelectPromptArgs<QueryReturnType>,
  queryItemAccumulator: QueryReturnType[],
  selectedIdsAccumulator: string[]
): Promise<QueryReturnType[] | void> {
  // query an extra item to determine if there are more pages left
  const paginatedItems = await queryToPerform(limit + 1, offset);
  const areMorePagesAvailable = paginatedItems.length > limit;
  // drop that extra item used for pagination from our render logic
  const currentPage = paginatedItems.slice(0, limit);
  const newQueryItemAccumulator = [...queryItemAccumulator, ...currentPage];

  const selectionPromptListItems = uniqBy(newQueryItemAccumulator, queryItem =>
    promptOptions.getIdentifierForQueryItem(queryItem)
  ).map<ExpoChoice<string>>(queryItem => ({
    title: promptOptions.createDisplayTextForSelectionPromptListItem(queryItem),
    value: promptOptions.getIdentifierForQueryItem(queryItem),
    selected: selectedIdsAccumulator.includes(promptOptions.getIdentifierForQueryItem(queryItem)),
  }));
  if (areMorePagesAvailable) {
    selectionPromptListItems.push({ title: 'Next page...', value: PAGINATION_FETCH_MORE_VALUE });
  }
  if (selectionPromptListItems.length === 0) {
    return;
  }

  const valueOfUserSelectedListItems = await multiselectAsync(
    promptOptions.title,
    selectionPromptListItems
  );
  const newSelectedIdsAccumulator = valueOfUserSelectedListItems.filter(
    id => id !== PAGINATION_FETCH_MORE_VALUE
  );

  if (valueOfUserSelectedListItems.includes(PAGINATION_FETCH_MORE_VALUE)) {
    return await paginatedQueryWithMultiSelectPromptInternalAsync(
      {
        limit,
        offset: offset + limit,
        queryToPerform,
        promptOptions,
      },
      newQueryItemAccumulator,
      newSelectedIdsAccumulator
    );
  }

  return newQueryItemAccumulator.filter(queryItem =>
    newSelectedIdsAccumulator.includes(promptOptions.getIdentifierForQueryItem(queryItem))
  );
}
