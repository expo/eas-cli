import assert from 'assert';
import chalk from 'chalk';
import CliTable from 'cli-table3';

import { PaginatedQueryOptions } from '../commandUtils/pagination';
import {
  UpdateFragment,
  ViewUpdateGroupsOnAppQueryVariables,
  ViewUpdateGroupsOnBranchQueryVariables,
} from '../graphql/generated';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
import {
  UPDATE_COLUMNS,
  UPDATE_COLUMNS_WITH_BRANCH,
  formatUpdateTitle,
  getUpdateGroupDescriptions,
  getUpdateGroupDescriptionsWithBranch,
} from './utils';

export const UPDATES_LIMIT = 50;
export const UPDATE_GROUPS_LIMIT = 25;

export async function listAndRenderUpdateGroupsOnAppAsync({
  projectId,
  paginatedQueryOptions,
}: {
  projectId: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnAppAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
    });
    renderUpdateGroupsOnAppAsTable(updateGroups, paginatedQueryOptions);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryUpdateGroupsOnAppAsync({ limit, offset, appId: projectId }),
      promptOptions: {
        title: 'Load more update groups?',
        renderListItems: updateGroups =>
          renderUpdateGroupsOnAppAsTable(updateGroups, paginatedQueryOptions),
      },
    });
  }
}

export async function listAndRenderUpdateGroupsOnBranchAsync({
  projectId,
  branchName,
  paginatedQueryOptions,
}: {
  projectId: string;
  branchName: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnBranchAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
      branchName,
    });
    renderUpdateGroupsOnBranchAsTable({ updateGroups, branchName, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryUpdateGroupsOnBranchAsync({ limit, offset, appId: projectId, branchName }),
      promptOptions: {
        title: 'Load more update groups?',
        renderListItems: updateGroups =>
          renderUpdateGroupsOnBranchAsTable({ updateGroups, branchName, paginatedQueryOptions }),
      },
    });
  }
}

export async function selectUpdateGroupOnBranchAsync({
  projectId,
  branchName,
  paginatedQueryOptions: painatedQueryOptions,
}: {
  projectId: string;
  branchName: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<UpdateFragment[]> {
  if (painatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select an update in non-interactive mode.');
  }

  const updateGroup = await paginatedQueryWithSelectPromptAsync({
    limit: painatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
    offset: painatedQueryOptions.offset,
    queryToPerform: (limit, offset) =>
      queryUpdateGroupsOnBranchAsync({ appId: projectId, branchName, limit, offset }),
    promptOptions: {
      title: 'Load more update groups?',
      createDisplayTextForSelectionPromptListItem: updateGroup => formatUpdateTitle(updateGroup[0]),
      getIdentifierForQueryItem: updateGroup => updateGroup[0].group,
    },
  });

  if (!updateGroup || updateGroup.length === 0) {
    throw new Error(`Could not find any branches for project "${projectId}"`);
  }

  return updateGroup;
}

async function queryUpdateGroupsOnBranchAsync(
  args: ViewUpdateGroupsOnBranchQueryVariables
): Promise<UpdateFragment[][]> {
  return await UpdateQuery.viewUpdateGroupsOnBranchAsync(args);
}

async function queryUpdateGroupsOnAppAsync(
  args: ViewUpdateGroupsOnAppQueryVariables
): Promise<UpdateFragment[][]> {
  return await UpdateQuery.viewUpdateGroupsOnAppAsync(args);
}

function renderUpdateGroupsOnBranchAsTable({
  updateGroups,
  branchName,
  paginatedQueryOptions: { json },
}: {
  updateGroups: UpdateFragment[][];
  branchName: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  const branchNames = updateGroups.flatMap(updateGroup =>
    updateGroup.map(update => update.branch.name)
  );
  assert(
    branchNames.every(name => name === branchName),
    'Each update must belong to the same branch.'
  );

  const branch = {
    name: branchName,
    id: updateGroups[0]?.[0].branch.id ?? 'N/A',
  };

  const updateGroupDescriptions = getUpdateGroupDescriptions(updateGroups);

  if (json) {
    printJsonOnlyOutput({ ...branch, currentPage: updateGroupDescriptions });
  } else {
    const updateGroupsTable = new CliTable({
      head: UPDATE_COLUMNS,
      wordWrap: true,
    });

    updateGroupDescriptions.forEach(({ message, runtimeVersion, group, platforms }) => {
      updateGroupsTable.push([message, runtimeVersion, group, platforms]);
    });

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

function renderUpdateGroupsOnAppAsTable(
  updateGroups: UpdateFragment[][],
  { json }: PaginatedQueryOptions
): void {
  const updateGroupDescriptions = getUpdateGroupDescriptionsWithBranch(updateGroups);

  if (json) {
    printJsonOnlyOutput({ currentPage: updateGroupDescriptions });
  } else {
    const updateGroupsTable = new CliTable({
      head: UPDATE_COLUMNS_WITH_BRANCH,
      wordWrap: true,
    });

    updateGroupDescriptions.forEach(({ branch, message, runtimeVersion, group, platforms }) => {
      updateGroupsTable.push([branch, message, runtimeVersion, group, platforms]);
    });

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Recent update groups:'));
    Log.addNewLineIfNone();
    Log.log(updateGroupsTable.toString());
  }
}
