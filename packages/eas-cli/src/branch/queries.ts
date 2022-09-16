import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { UpdateBranchFragment } from '../graphql/generated';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import Log from '../log';
import { UPDATE_COLUMNS, formatUpdateMessage, getPlatformsForGroup } from '../update/utils';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';

export const BRANCHES_LIMIT = 50;

export async function selectBranchOnAppAsync({
  projectId,
  promptTitle,
  displayTextForListItem,
  paginatedQueryOptions,
}: {
  projectId: string;
  displayTextForListItem: (queryItem: UpdateBranchFragment) => string;
  promptTitle: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<UpdateBranchFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select a branch in non-interactive mode.');
  }

  const selectedBranch = await paginatedQueryWithSelectPromptAsync({
    limit: paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
    offset: paginatedQueryOptions.offset,
    queryToPerform: (limit, offset) => queryBranchesOnProjectAsync(limit, offset, projectId),
    promptOptions: {
      title: promptTitle,
      getIdentifierForQueryItem: updateBranchFragment => updateBranchFragment.id,
      createDisplayTextForSelectionPromptListItem: displayTextForListItem,
    },
  });
  if (!selectedBranch) {
    throw new Error(`Could not find any branches for project "${projectId}"`);
  }
  return selectedBranch;
}

export async function listAndRenderBranchesOnAppAsync({
  projectId,
  paginatedQueryOptions,
}: {
  projectId: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const branches = await queryBranchesOnProjectAsync(
      paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
      paginatedQueryOptions.offset,
      projectId
    );
    renderPageOfBranches(branches, paginatedQueryOptions);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) => queryBranchesOnProjectAsync(limit, offset, projectId),
      promptOptions: {
        title: 'Load more branches?',
        renderListItems: branches => renderPageOfBranches(branches, paginatedQueryOptions),
      },
    });
  }
}

async function queryBranchesOnProjectAsync(
  limit: number,
  offset: number,
  projectId: string
): Promise<UpdateBranchFragment[]> {
  return await BranchQuery.listBranchesOnAppAsync({
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
      ...currentPage.map(branch => {
        if (branch.updates.length === 0) {
          return [branch.name, 'N/A', 'N/A', 'N/A', 'N/A'];
        }

        const latestUpdateOnBranch = branch.updates[0];
        return [
          branch.name,
          formatUpdateMessage(latestUpdateOnBranch),
          latestUpdateOnBranch.runtimeVersion,
          latestUpdateOnBranch.group,
          getPlatformsForGroup({
            group: latestUpdateOnBranch.group,
            updates: branch.updates,
          }),
        ];
      })
    );

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Branches:'));
    Log.addNewLineIfNone();
    Log.log(table.toString());
  }
}
