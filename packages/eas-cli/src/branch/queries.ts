import chalk from 'chalk';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  CreateUpdateBranchForAppMutation,
  CreateUpdateBranchForAppMutationVariables,
  PageInfo,
  UpdateBranch,
  UpdateBranchBasicInfoFragment,
  UpdateBranchFragment,
} from '../graphql/generated';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import Log from '../log';
import { ora } from '../ora';
import { formatBranch, getBranchDescription } from '../update/utils';
import { printJsonOnlyOutput } from '../utils/json';
import {
  SelectPromptEntry,
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
import { Connection, QueryParams, getPaginatedDatasetAsync } from '../utils/relay';
import { BranchNotFoundError } from './utils';

export const BRANCHES_LIMIT = 50;

export async function selectBranchOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    promptTitle,
    displayTextForListItem,
    paginatedQueryOptions,
  }: {
    projectId: string;
    displayTextForListItem: (queryItem: UpdateBranchFragment) => SelectPromptEntry;
    promptTitle: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<UpdateBranchFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select a branch in non-interactive mode.');
  }

  const selectedBranch = await paginatedQueryWithSelectPromptAsync({
    limit: paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
    offset: paginatedQueryOptions.offset,
    queryToPerform: (limit, offset) =>
      queryBranchesOnProjectAsync(graphqlClient, limit, offset, projectId),
    promptOptions: {
      title: promptTitle,
      getIdentifierForQueryItem: updateBranchFragment => updateBranchFragment.id,
      makePartialChoiceObject: displayTextForListItem,
    },
  });
  if (!selectedBranch) {
    throw new Error(`Could not find any branches for project "${projectId}"`);
  }
  return selectedBranch;
}

export async function listAndRenderBranchesOnAppAsync(
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
    const branches = await queryBranchesOnProjectAsync(
      graphqlClient,
      paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
      paginatedQueryOptions.offset,
      projectId
    );
    renderPageOfBranches(branches, paginatedQueryOptions);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? BRANCHES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryBranchesOnProjectAsync(graphqlClient, limit, offset, projectId),
      promptOptions: {
        title: 'Load more branches?',
        renderListItems: branches => renderPageOfBranches(branches, paginatedQueryOptions),
      },
    });
  }
}

async function queryBranchesOnProjectAsync(
  graphqlClient: ExpoGraphqlClient,
  limit: number,
  offset: number,
  projectId: string
): Promise<UpdateBranchFragment[]> {
  return await BranchQuery.listBranchesOnAppAsync(graphqlClient, {
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
    Log.addNewLineIfNone();
    Log.log(chalk.bold('Branches:'));
    Log.addNewLineIfNone();
    Log.log(
      currentPage
        .map(branch => formatBranch(getBranchDescription(branch)))
        .join(`\n\n${chalk.dim('———')}\n\n`)
    );
  }
}

export async function createUpdateBranchOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, name }: CreateUpdateBranchForAppMutationVariables
): Promise<Pick<UpdateBranch, 'id' | 'name'>> {
  const result = await withErrorHandlingAsync(
    graphqlClient
      .mutation<CreateUpdateBranchForAppMutation, CreateUpdateBranchForAppMutationVariables>(
        gql`
          mutation CreateUpdateBranchForApp($appId: ID!, $name: String!) {
            updateBranch {
              createUpdateBranchForApp(appId: $appId, name: $name) {
                id
                name
              }
            }
          }
        `,
        {
          appId,
          name,
        }
      )
      .toPromise()
  );
  const newBranch = result.updateBranch.createUpdateBranchForApp;
  if (!newBranch) {
    throw new Error(`Could not create branch ${name}.`);
  }
  return newBranch;
}

export async function ensureBranchExistsAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchName,
  }: {
    appId: string;
    branchName: string;
  }
): Promise<{ branchId: string; createdBranch: boolean }> {
  try {
    const updateBranch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
      appId,
      name: branchName,
    });

    const { id } = updateBranch;
    return { branchId: id, createdBranch: false };
  } catch (error) {
    if (error instanceof BranchNotFoundError) {
      const newUpdateBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
        appId,
        name: branchName,
      });
      return { branchId: newUpdateBranch.id, createdBranch: true };
    } else {
      throw error;
    }
  }
}

export async function getBranchesDatasetAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    filterPredicate,
    batchSize = 100,
  }: {
    appId: string;
    filterPredicate?: (branchInfo: UpdateBranchBasicInfoFragment) => boolean;
    batchSize?: number;
  }
): Promise<UpdateBranchBasicInfoFragment[]> {
  const queryAsync = async ({
    first,
    after,
  }: QueryParams): Promise<Connection<UpdateBranchBasicInfoFragment>> =>
    await BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync(graphqlClient, {
      appId,
      first,
      after,
    });

  const assetSpinner = ora().start('Fetching branches...');
  const afterEachQuery = (
    totalNodesFetched: number,
    _dataset: UpdateBranchBasicInfoFragment[],
    _batch: UpdateBranchBasicInfoFragment[],
    pageInfo: PageInfo
  ): void => {
    if (pageInfo.hasNextPage) {
      assetSpinner.text = `Fetched ${totalNodesFetched} branches`;
    }
  };
  const dataset = await getPaginatedDatasetAsync({
    queryAsync,
    afterEachQuery,
    filterPredicate,
    batchSize,
  });
  assetSpinner.succeed(`Fetched all branches`);
  return dataset;
}
