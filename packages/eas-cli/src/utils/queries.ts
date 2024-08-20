import uniqBy from './expodash/uniqBy';
import { confirmAsync, selectAsync } from '../prompts';

const fetchMoreValue = '_fetchMore';

export interface SelectPromptEntry {
  title: string;
  description?: string;
  disabled?: boolean;
}

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
      makePartialChoiceObject: (queryItem: QueryReturnType) => SelectPromptEntry;
      getIdentifierForQueryItem: (queryItem: QueryReturnType) => string;
      readonly selectPromptWarningMessage?: string;
    };
  };

export async function paginatedQueryWithConfirmPromptAsync<
  QueryReturnType extends Record<string, any>,
>(queryArgs: PaginatedQueryWithConfirmPromptArgs<QueryReturnType>): Promise<void> {
  await paginatedQueryWithConfirmPromptInternalAsync(queryArgs, []);
}

async function paginatedQueryWithConfirmPromptInternalAsync<
  QueryReturnType extends Record<string, any>,
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
    await paginatedQueryWithConfirmPromptInternalAsync(
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

/**
 * Returns an array of item(s) where the id is equal to the id of the user's selected item
 * If no items are available for a user to select, this will return an empty array.
 */
export async function paginatedQueryWithSelectPromptAsync<
  QueryReturnType extends Record<string, any>,
>(queryArgs: PaginatedQueryWithSelectPromptArgs<QueryReturnType>): Promise<QueryReturnType | void> {
  return await paginatedQueryWithSelectPromptInternalAsync(queryArgs, []);
}

async function paginatedQueryWithSelectPromptInternalAsync<
  QueryReturnType extends Record<string, any>,
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
  ).map(queryItem => ({
    ...promptOptions.makePartialChoiceObject(queryItem),
    value: promptOptions.getIdentifierForQueryItem(queryItem),
  }));
  if (areMorePagesAvailable) {
    selectionPromptListItems.push({ title: 'Next page...', value: fetchMoreValue });
  }
  if (selectionPromptListItems.length === 0) {
    return;
  }

  const valueOfUserSelectedListItem = await selectAsync<string>(
    promptOptions.title,
    selectionPromptListItems,
    {
      warningMessageForDisabledEntries: promptOptions.selectPromptWarningMessage,
    }
  );

  if (valueOfUserSelectedListItem === fetchMoreValue) {
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
