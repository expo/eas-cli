import { confirmAsync, selectAsync } from '../prompts';
import uniqBy from './expodash/uniqBy';

export type PaginatedQueryResponse<QueryReturnType extends Record<string, any>> = {
  queryResponse: QueryReturnType[];
  queryResponseRawLength: number;
};

export type PromptSelectionListItem = {
  title: string;
  value: string;
};

export type PaginatedQueryArguments<QueryReturnType extends Record<string, any>> = {
  pageSize: number;
  offset: number;
  queryToPerform: (
    pageSize: number,
    offset: number
  ) => Promise<PaginatedQueryResponse<QueryReturnType>>;
  promptOptions: PaginatedQueryPromptOptions<QueryReturnType>;
};

export interface PaginatedQuerySelectPrompt<QueryReturnType extends Record<string, any>> {
  readonly title: string;
  readonly type: 'select';
  createDisplayTextForSelectionPromptListItem: (queryItem: QueryReturnType) => string;
  getIdentifierForQueryItem: (queryItem: QueryReturnType) => string;
}

export interface PaginatedQueryConfirmPrompt<QueryReturnType extends Record<string, any>> {
  readonly type: 'confirm';
  readonly title: string;
  renderListItems: (currentPage: QueryReturnType[]) => void;
}

type PaginatedQueryPromptOptions<QueryReturnType extends Record<string, any>> =
  | PaginatedQueryConfirmPrompt<QueryReturnType>
  | PaginatedQuerySelectPrompt<QueryReturnType>;

/**
 * Return an empty array when the promptOptions type is PaginatedQueryConfirmPrompt
 * Returns an array of the selected items when the promptOptions type is PaginatedQuerySelectPrompt
 */
export async function performPaginatedQueryAsync<QueryReturnType extends Record<string, any>>(
  { pageSize, offset, queryToPerform, promptOptions }: PaginatedQueryArguments<QueryReturnType>,
  accumulator?: QueryReturnType[]
): Promise<QueryReturnType[]> {
  const fetchMoreValue = '_fetchMore';

  // query an extra item to determine if there are more pages left
  const { queryResponse: items, queryResponseRawLength } = await queryToPerform(
    pageSize + 1,
    offset
  );
  const areMorePagesAvailable = queryResponseRawLength > pageSize;
  // drop that extra item used for pagination from our render logic when extra pages are available
  const currentPage = items.slice(0, areMorePagesAvailable ? items.length - 1 : undefined);
  accumulator = [...(accumulator ?? []), ...currentPage];

  let valueOfUserSelectedListItem = '';

  if (promptOptions.type === 'confirm') {
    promptOptions.renderListItems(currentPage);
    if (areMorePagesAvailable) {
      valueOfUserSelectedListItem = (await confirmAsync({ message: promptOptions.title }))
        ? fetchMoreValue
        : '';
    }
  } else {
    const selectionPromptListItems = uniqBy(accumulator, queryItem =>
      promptOptions.getIdentifierForQueryItem(queryItem)
    ).map(queryItem => ({
      title: promptOptions.createDisplayTextForSelectionPromptListItem(queryItem),
      value: promptOptions.getIdentifierForQueryItem(queryItem),
    }));
    if (areMorePagesAvailable) {
      selectionPromptListItems.push({ title: 'Next page...', value: fetchMoreValue });
    }
    if (selectionPromptListItems.length) {
      valueOfUserSelectedListItem = await selectAsync<string>(
        promptOptions.title,
        selectionPromptListItems
      );
    }
  }

  if (valueOfUserSelectedListItem === fetchMoreValue) {
    return await performPaginatedQueryAsync(
      {
        pageSize,
        offset: offset + pageSize,
        queryToPerform,
        promptOptions,
      },
      accumulator
    );
  }

  if (promptOptions.type === 'select') {
    return accumulator.filter(
      update => promptOptions.getIdentifierForQueryItem(update) === valueOfUserSelectedListItem
    );
  }

  return [];
}
