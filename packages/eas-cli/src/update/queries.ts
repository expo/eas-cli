import assert from 'assert';
import chalk from 'chalk';

import {
  formatBranch,
  formatUpdateGroup,
  formatUpdateTitle,
  getUpdateGroupDescriptionsWithBranch,
} from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
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

export const UPDATES_LIMIT = 50;
export const UPDATE_GROUPS_LIMIT = 25;

export async function listAndRenderUpdateGroupsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    paginatedQueryOptions,
  }: {
    projectId: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnAppAsync(graphqlClient, {
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
    });
    renderUpdateGroupsOnApp({ updateGroups, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryUpdateGroupsOnAppAsync(graphqlClient, { limit, offset, appId: projectId }),
      promptOptions: {
        title: 'Load more update groups?',
        renderListItems: updateGroups => {
          renderUpdateGroupsOnApp({ updateGroups, paginatedQueryOptions });
        },
      },
    });
  }
}

export async function listAndRenderUpdateGroupsOnBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    branchName,
    paginatedQueryOptions,
  }: {
    projectId: string;
    branchName: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnBranchAsync(graphqlClient, {
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
      branchName,
    });
    renderUpdateGroupsOnBranch({ updateGroups, branchName, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryUpdateGroupsOnBranchAsync(graphqlClient, {
          limit,
          offset,
          appId: projectId,
          branchName,
        }),
      promptOptions: {
        title: 'Load more update groups?',
        renderListItems: updateGroups => {
          renderUpdateGroupsOnBranch({ updateGroups, branchName, paginatedQueryOptions });
        },
      },
    });
  }
}

export async function selectUpdateGroupOnBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    branchName,
    paginatedQueryOptions,
  }: {
    projectId: string;
    branchName: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<UpdateFragment[]> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select an update in non-interactive mode.');
  }

  const updateGroup = await paginatedQueryWithSelectPromptAsync({
    limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
    offset: paginatedQueryOptions.offset,
    queryToPerform: (limit, offset) =>
      queryUpdateGroupsOnBranchAsync(graphqlClient, {
        appId: projectId,
        branchName,
        limit,
        offset,
      }),
    promptOptions: {
      title: 'Load more update groups?',
      makePartialChoiceObject: updateGroup => ({
        title: formatUpdateTitle(updateGroup[0]),
      }),
      getIdentifierForQueryItem: updateGroup => updateGroup[0].group,
    },
  });

  if (!updateGroup || updateGroup.length === 0) {
    throw new Error(`Could not find any branches for project "${projectId}"`);
  }

  return updateGroup;
}

async function queryUpdateGroupsOnBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  args: ViewUpdateGroupsOnBranchQueryVariables
): Promise<UpdateFragment[][]> {
  return await UpdateQuery.viewUpdateGroupsOnBranchAsync(graphqlClient, args);
}

async function queryUpdateGroupsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  args: ViewUpdateGroupsOnAppQueryVariables
): Promise<UpdateFragment[][]> {
  return await UpdateQuery.viewUpdateGroupsOnAppAsync(graphqlClient, args);
}

function renderUpdateGroupsOnBranch({
  branchName,
  updateGroups,
  paginatedQueryOptions: { json },
}: {
  branchName: string;
  updateGroups: UpdateFragment[][];
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  // Ensure all updates are from the same branch
  const branchNames = updateGroups.flatMap(updateGroup =>
    updateGroup.map(update => update.branch.name)
  );
  assert(
    branchNames.every(name => name === branchName),
    'Each update must belong to the same branch.'
  );

  const updateGroupDescriptions = getUpdateGroupDescriptionsWithBranch(updateGroups);
  const branch = {
    name: branchName,
    id: updateGroups[0]?.[0].branch.id ?? 'N/A',
  };

  if (json) {
    printJsonOnlyOutput({ ...branch, currentPage: updateGroupDescriptions });
    return;
  }

  Log.addNewLineIfNone();
  Log.log(chalk.bold('Branch:'));
  Log.log(
    formatFields([
      { label: 'Name', value: branch.name },
      { label: 'ID', value: branch.id },
    ])
  );
  Log.newLine();
  Log.log(chalk.bold('Recent update groups:'));
  Log.newLine();
  Log.log(
    updateGroupDescriptions
      .map(description => formatUpdateGroup(description))
      .join(`\n\n${chalk.dim('———')}\n\n`)
  );
}

function renderUpdateGroupsOnApp({
  updateGroups,
  paginatedQueryOptions: { json },
}: {
  updateGroups: UpdateFragment[][];
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  const updateGroupDescriptions = getUpdateGroupDescriptionsWithBranch(updateGroups);

  if (json) {
    printJsonOnlyOutput({ currentPage: updateGroupDescriptions });
  }

  Log.addNewLineIfNone();
  Log.log(chalk.bold('Recent update groups:'));
  Log.newLine();
  Log.log(
    updateGroupDescriptions
      .map(({ branch, ...update }) =>
        formatBranch({
          branch,
          update,
        })
      )
      .join(`\n\n${chalk.dim('———')}\n\n`)
  );
}
