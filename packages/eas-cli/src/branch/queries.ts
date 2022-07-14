import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryFlags } from '../commandUtils/flagHelpers';
import { UpdateBranchFragment } from '../graphql/generated';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import Log from '../log';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../update/utils';
import { printJsonOnlyOutput } from '../utils/json';
import {
  PaginatedQueryPromptOptions,
  PaginatedQueryPromptType,
  PaginatedQueryResponse,
  performPaginatedQueryAsync,
} from '../utils/queries';

export const BRANCHES_LIMIT = 50;

export async function selectBranchForProjectAsync(
  projectId: string,
  promptTitle: string,
  flags: PaginatedQueryFlags
): Promise<UpdateBranchFragment> {
  if (flags['non-interactive']) {
    throw new Error('Unable to select a branch in non-interactive mode.');
  }

  const fromatUpdateBranchFragment = (updateBranchFragment: UpdateBranchFragment): string =>
    updateBranchFragment.name;
  const getIdentifierForQueryItem = (updateBranchFragment: UpdateBranchFragment): string =>
    updateBranchFragment.id;

  const branch = await performPaginatedQueryAsync({
    pageSize: flags.limit ?? BRANCHES_LIMIT,
    offset: flags.offset ?? 0,
    queryToPerform: queryBranchesForProject(projectId),
    promptOptions: {
      type: PaginatedQueryPromptType.select,
      title: promptTitle,
      getIdentifierForQueryItem,
      createDisplayTextForSelectionPromptListItem: fromatUpdateBranchFragment,
    },
  });
  return branch.pop()!;
}

export async function queryForBranchesAsync(
  projectId: string,
  flags: PaginatedQueryFlags
): Promise<void> {
  const promptOptions: PaginatedQueryPromptOptions<UpdateBranchFragment> =
    flags['non-interactive'] || flags.limit
      ? { type: PaginatedQueryPromptType.none, renderQueryResults: renderPageOfBranches(flags) }
      : {
          type: PaginatedQueryPromptType.confirm,
          title: 'Load more branches?',
          renderListItems: renderPageOfBranches(flags),
        };

  await performPaginatedQueryAsync({
    pageSize: flags.limit ?? BRANCHES_LIMIT,
    offset: flags.offset ?? 0,
    queryToPerform: queryBranchesForProject(projectId),
    promptOptions,
  });
}

const queryBranchesForProject =
  (projectId: string) =>
  async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<UpdateBranchFragment>> => {
    const branches = await BranchQuery.listBranchesAsync({
      appId: projectId,
      limit: pageSize,
      offset,
    });
    return {
      queryResponse: branches,
      queryResponseRawLength: branches.length,
    };
  };

const renderPageOfBranches =
  (flags: PaginatedQueryFlags) =>
  (currentPage: UpdateBranchFragment[]): void => {
    if (flags.json) {
      printJsonOnlyOutput(currentPage);
    } else {
      const table = new CliTable({
        head: ['Branch', ...UPDATE_COLUMNS],
        wordWrap: true,
      });

      table.push(
        ...currentPage.map(branch => [
          branch.name,
          formatUpdate(branch.updates[0]),
          branch.updates[0]?.runtimeVersion ?? 'N/A',
          branch.updates[0]?.group ?? 'N/A',
          getPlatformsForGroup({
            updates: branch.updates,
            group: branch.updates[0]?.group,
          }),
        ])
      );

      Log.addNewLineIfNone();
      Log.log(chalk.bold('Branches:'));
      Log.addNewLineIfNone();
      Log.log(table.toString());
    }
  };
