import assert from 'assert';
import chalk from 'chalk';

import {
  UpdatePublishPlatform,
  formatBranch,
  formatUpdateGroup,
  formatUpdateTitle,
  getUpdateGroupDescriptionsWithBranch,
} from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import {
  AppPlatform,
  RuntimeFragment,
  UpdateFragment,
  ViewUpdateGroupsOnAppQueryVariables,
  ViewUpdateGroupsOnBranchQueryVariables,
} from '../graphql/generated';
import { RuntimeQuery } from '../graphql/queries/RuntimeQuery';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
import { Connection, QueryParams, selectPaginatedAsync } from '../utils/relay';

export const UPDATES_LIMIT = 50;
export const UPDATE_GROUPS_LIMIT = 25;
export const RUNTIME_VERSIONS_LIMIT = 25;

export async function listAndRenderUpdateGroupsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    filter,
    paginatedQueryOptions,
  }: {
    projectId: string;
    filter?: ViewUpdateGroupsOnAppQueryVariables['filter'];
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnAppAsync(graphqlClient, {
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
      filter,
    });
    renderUpdateGroupsOnApp({ updateGroups, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryUpdateGroupsOnAppAsync(graphqlClient, { limit, offset, appId: projectId, filter }),
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
    filter,
    paginatedQueryOptions,
  }: {
    projectId: string;
    branchName: string;
    filter?: ViewUpdateGroupsOnBranchQueryVariables['filter'];
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const updateGroups = await queryUpdateGroupsOnBranchAsync(graphqlClient, {
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
      appId: projectId,
      branchName,
      filter,
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
          filter,
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

export async function selectRuntimeAndGetLatestUpdateGroupForEachPublishPlatformOnBranchAsync(
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
): Promise<Record<UpdatePublishPlatform, UpdateFragment[] | undefined>> {
  if (paginatedQueryOptions.nonInteractive) {
    const runtimes = await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
      appId: projectId,
      name: branchName,
      first: RUNTIME_VERSIONS_LIMIT,
    });
    if (runtimes.edges.length === 0) {
      throw new Error(`No runtime versions found on branch "${branchName}".`);
    }
    const runtimeList = runtimes.edges.map(e => e.node.version).join('\n  ');
    throw new Error(
      `Unable to select a runtime in non-interactive mode. Available runtime versions on branch "${branchName}":\n  ${runtimeList}`
    );
  }

  const runtimeVersion = await selectRuntimeOnBranchAsync(graphqlClient, {
    appId: projectId,
    branchName,
  });
  if (!runtimeVersion) {
    throw new Error('No runtime version selected.');
  }

  return {
    ios: (
      await queryUpdateGroupsOnBranchAsync(graphqlClient, {
        appId: projectId,
        branchName,
        limit: 1,
        offset: 0,
        filter: {
          runtimeVersions: [runtimeVersion.version],
          platform: AppPlatform.Ios,
        },
      })
    )[0],
    android: (
      await queryUpdateGroupsOnBranchAsync(graphqlClient, {
        appId: projectId,
        branchName,
        limit: 1,
        offset: 0,
        filter: {
          runtimeVersions: [runtimeVersion.version],
          platform: AppPlatform.Android,
        },
      })
    )[0],
  };
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
    const updateGroups = await queryUpdateGroupsOnBranchAsync(graphqlClient, {
      appId: projectId,
      branchName,
      limit: paginatedQueryOptions.limit ?? UPDATE_GROUPS_LIMIT,
      offset: paginatedQueryOptions.offset,
    });
    if (updateGroups.length === 0) {
      throw new Error(`No update groups found on branch "${branchName}".`);
    }
    const updateList = updateGroups
      .map(group => {
        const first = group[0];
        return first
          ? `${first.group} (runtime: ${first.runtimeVersion}, message: ${first.message ?? 'N/A'})`
          : 'unknown';
      })
      .join('\n  ');
    throw new Error(
      `Unable to select an update in non-interactive mode. Use the --group flag to specify the update group. Available update groups on branch "${branchName}":\n  ${updateList}`
    );
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

export async function selectRuntimeOnBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchName,
    batchSize = 5,
  }: {
    appId: string;
    branchName: string;
    batchSize?: number;
  }
): Promise<RuntimeFragment | null> {
  const queryAsync = async (queryParams: QueryParams): Promise<Connection<RuntimeFragment>> => {
    return await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
      appId,
      name: branchName,
      first: queryParams.first,
      after: queryParams.after,
      last: queryParams.last,
      before: queryParams.before,
    });
  };
  const getTitleAsync = async (runtime: RuntimeFragment): Promise<string> => {
    return runtime.version;
  };
  return await selectPaginatedAsync({
    queryAsync,
    getTitleAsync,
    printedType: 'target runtime',
    pageSize: batchSize,
  });
}
