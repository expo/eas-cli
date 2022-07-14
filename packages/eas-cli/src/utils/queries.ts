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

export enum PaginatedQueryPromptType {
  select,
  confirm,
  none,
}

export interface PaginatedQuerySelectPrompt<QueryReturnType extends Record<string, any>> {
  readonly type: PaginatedQueryPromptType.select;
  readonly title: string;
  createDisplayTextForSelectionPromptListItem: (queryItem: QueryReturnType) => string;
  getIdentifierForQueryItem: (queryItem: QueryReturnType) => string;
}

export interface PaginatedQueryConfirmPrompt<QueryReturnType extends Record<string, any>> {
  readonly type: PaginatedQueryPromptType.confirm;
  readonly title: string;
  renderListItems: (currentPage: QueryReturnType[]) => void;
}
export interface PaginatedQueryNoPrompt<QueryReturnType extends Record<string, any>> {
  readonly type: PaginatedQueryPromptType.none;
  renderQueryResults: (queryResults: QueryReturnType[]) => void;
}

export type PaginatedQueryPromptOptions<QueryReturnType extends Record<string, any>> =
  | PaginatedQueryConfirmPrompt<QueryReturnType>
  | PaginatedQuerySelectPrompt<QueryReturnType>
  | PaginatedQueryNoPrompt<QueryReturnType>;

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
  switch (promptOptions.type) {
    case PaginatedQueryPromptType.select: {
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
      break;
    }

    case PaginatedQueryPromptType.confirm:
      promptOptions.renderListItems(currentPage);
      if (areMorePagesAvailable) {
        valueOfUserSelectedListItem = (await confirmAsync({ message: promptOptions.title }))
          ? fetchMoreValue
          : '';
      }
      break;

    case PaginatedQueryPromptType.none:
      break;
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

  switch (promptOptions.type) {
    case PaginatedQueryPromptType.select:
      return accumulator.filter(
        update => promptOptions.getIdentifierForQueryItem(update) === valueOfUserSelectedListItem
      );
    case PaginatedQueryPromptType.none:
      promptOptions.renderQueryResults(accumulator);
    // falls through
    case PaginatedQueryPromptType.confirm:
      return [];
  }
}
