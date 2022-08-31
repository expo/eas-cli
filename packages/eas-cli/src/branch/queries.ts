import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { UpdateBranchFragment } from '../graphql/generated';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import Log from '../log';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../update/utils';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';

export const BRANCHES_LIMIT = 50;

export async function selectBranchFromPaginatedQueryAsync(
  projectId: string,
  promptTitle: string,
  options: PaginatedQueryOptions
): Promise<UpdateBranchFragment> {
  if (options.nonInteractive) {
    throw new Error('Unable to select a branch in non-interactive mode.');
  }

  const selectedBranch = await paginatedQueryWithSelectPromptAsync({
    limit: options.limit ?? BRANCHES_LIMIT,
    offset: options.offset,
    queryToPerform: (limit, offset) => queryBranchesForProjectAsync(limit, offset, projectId),
    promptOptions: {
      title: promptTitle,
      getIdentifierForQueryItem: updateBranchFragment => updateBranchFragment.id,
      createDisplayTextForSelectionPromptListItem: updateBranchFragment =>
        updateBranchFragment.name,
    },
  });
  if (!selectedBranch) {
    throw new Error(`Could not find any branches for project "${projectId}"`);
  }
  return selectedBranch;
}

export async function listAndRenderPaginatedBranchesAsync(
  projectId: string,
  options: PaginatedQueryOptions
): Promise<void> {
  if (options.nonInteractive) {
    const branches = await queryBranchesForProjectAsync(
      options.limit ?? BRANCHES_LIMIT,
      options.offset,
      projectId
    );
    renderPageOfBranches(branches, options);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: options.limit ?? BRANCHES_LIMIT,
      offset: options.offset,
      queryToPerform: (limit, offset) => queryBranchesForProjectAsync(limit, offset, projectId),
      promptOptions: {
        title: 'Load more branches?',
        renderListItems: branches => renderPageOfBranches(branches, options),
      },
    });
  }
}

async function queryBranchesForProjectAsync(
  limit: number,
  offset: number,
  projectId: string
): Promise<UpdateBranchFragment[]> {
  return await BranchQuery.listBranchesAsync({
    appId: projectId,
    limit,
    offset,
  });
}

function renderPageOfBranches(
  currentPage: UpdateBranchFragment[],
  { json }: PaginatedQueryOptions
): void {
  if (json) {
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
          group: branch.updates[0]?.group ?? [],
        }),
      ])
    );

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Branches:'));
    Log.addNewLineIfNone();
    Log.log(table.toString());
  }
}
