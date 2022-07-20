import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { BranchUpdateObject, UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import { paginatedQueryWithConfirmPromptAsync } from '../utils/queries';
import { UPDATE_COLUMNS, formatUpdate, getUpdateGroupsWithPlatforms } from './utils';

export const UPDATES_LIMIT = 50;

export async function listAndRenderUpdatesOnBranchByNameAsync(
  projectId: string,
  branchName: string,
  options: PaginatedQueryOptions
): Promise<void> {
  if (options.nonInteractive || options.limit) {
    const updates = await queryUpdateGroupsForBranchAsync(
      options.limit ?? UPDATES_LIMIT,
      options.offset,
      projectId,
      branchName
    );
    renderUpdateGroups(updates, options, branchName);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: options.limit ?? UPDATES_LIMIT,
      offset: options.offset,
      queryToPerform: (pageSize, offset) =>
        queryUpdateGroupsForBranchAsync(pageSize, offset, projectId, branchName),
      promptOptions: {
        title: 'Load more branches?',
        renderListItems: updates => renderUpdateGroups(updates, options, branchName),
      },
    });
  }
}

async function queryUpdateGroupsForBranchAsync(
  pageSize: number,
  offset: number,
  projectId: string,
  branchName: string
): Promise<BranchUpdateObject[]> {
  const { app } = await UpdateQuery.viewBranchAsync({
    appId: projectId,
    name: branchName,
    limit: pageSize,
    offset,
  });

  const updateBranch = app?.byId.updateBranchByName;
  if (!updateBranch) {
    throw new Error(`Could not find branch "${branchName}"`);
  }

  return updateBranch.updates;
}

function renderUpdateGroups(
  updates: BranchUpdateObject[],
  { json }: PaginatedQueryOptions,
  branchName: string
): void {
  const branch = { name: branchName, id: updates[0]?.branch.id ?? 'N/A' };
  if (json) {
    printJsonOnlyOutput({ ...branch, currentPage: updates });
  } else {
    const updateGroupsTable = new CliTable({
      head: UPDATE_COLUMNS,
      wordWrap: true,
    });
    updateGroupsTable.push(
      ...getUpdateGroupsWithPlatforms(updates).map(update => [
        formatUpdate(update),
        update.runtimeVersion,
        update.group,
        update.platforms,
      ])
    );

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Branch:'));
    Log.log(
      formatFields([
        { label: 'Name', value: branch.name },
        { label: 'ID', value: branch.id },
      ])
    );
    Log.addNewLineIfNone();
    Log.log(updateGroupsTable.toString());
  }
}
