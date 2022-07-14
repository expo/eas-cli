import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryFlags } from '../commandUtils/flagHelpers';
import { BranchUpdateObject, UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import {
  PaginatedQueryPromptOptions,
  PaginatedQueryPromptType,
  PaginatedQueryResponse,
  performPaginatedQueryAsync,
} from '../utils/queries';
import { UPDATE_COLUMNS, formatUpdate, getUpdateGroupsWithPlatforms } from './utils';

export const UPDATES_LIMIT = 50;

export async function queryUpdatesOnBranchByNameAsync(
  projectId: string,
  branchName: string,
  flags: PaginatedQueryFlags
): Promise<void> {
  let updateBranch: { name: string; id: string };
  const queryUpdatesGroupsForBranchAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<BranchUpdateObject>> => {
    const { app } = await UpdateQuery.viewBranchAsync({
      appId: projectId,
      name: branchName,
      limit: pageSize,
      offset,
    });

    const UpdateBranch = app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${branchName}"`);
    }

    updateBranch = { id: UpdateBranch.id, name: UpdateBranch.name };
    return {
      queryResponse: UpdateBranch.updates,
      queryResponseRawLength: UpdateBranch.updates.length,
    };
  };

  const renderUpdateGroups = (currentPage: BranchUpdateObject[]): void => {
    if (flags.json) {
      printJsonOnlyOutput({ ...updateBranch, currentPage });
    } else {
      const updateGroupsTable = new CliTable({
        head: UPDATE_COLUMNS,
        wordWrap: true,
      });
      updateGroupsTable.push(
        ...getUpdateGroupsWithPlatforms(currentPage).map(update => [
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
          { label: 'Name', value: updateBranch.name },
          { label: 'ID', value: updateBranch.id! },
        ])
      );
      Log.addNewLineIfNone();
      Log.log(updateGroupsTable.toString());
    }
  };

  const promptOptions: PaginatedQueryPromptOptions<BranchUpdateObject> =
    flags['non-interactive'] || flags.limit
      ? { type: PaginatedQueryPromptType.none, renderQueryResults: renderUpdateGroups }
      : {
          type: PaginatedQueryPromptType.confirm,
          title: 'Load more branches?',
          renderListItems: renderUpdateGroups,
        };

  await performPaginatedQueryAsync({
    pageSize: flags.limit ?? UPDATES_LIMIT,
    offset: flags.offset ?? 0,
    queryToPerform: queryUpdatesGroupsForBranchAsync,
    promptOptions,
  });
}
