import chalk from 'chalk';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ChannelNotFoundError } from './errors';
import { logChannelDetails } from './print-utils';
import { ChannelBasicInfo } from './utils';
import { createUpdateBranchOnAppAsync } from '../branch/queries';
import { BranchNotFoundError } from '../branch/utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  CreateUpdateChannelOnAppMutation,
  CreateUpdateChannelOnAppMutationVariables,
  CreateUpdateChannelOnAppWithNoBranchMutation,
  CreateUpdateChannelOnAppWithNoBranchMutationVariables,
  DeleteUpdateChannelMutation,
  DeleteUpdateChannelMutationVariables,
  DeleteUpdateChannelResult,
  UpdateChannelBasicInfoFragment,
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
  ViewBranchesOnUpdateChannelQueryVariables,
  ViewUpdateChannelsOnAppQueryVariables,
} from '../graphql/generated';
import { BranchQuery, UpdateBranchOnChannelObject } from '../graphql/queries/BranchQuery';
import { ChannelQuery, UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import { UpdateChannelBasicInfoFragmentNode } from '../graphql/types/UpdateChannelBasicInfo';
import Log from '../log';
import { getDisplayNameForProjectIdAsync } from '../project/projectUtils';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';

export const CHANNELS_LIMIT = 25;

export async function selectChannelOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    selectionPromptTitle,
    paginatedQueryOptions,
  }: {
    projectId: string;
    selectionPromptTitle: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<UpdateChannelObject> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select a channel in non-interactive mode.');
  }

  const updateChannel = await paginatedQueryWithSelectPromptAsync({
    limit: paginatedQueryOptions.limit ?? CHANNELS_LIMIT,
    offset: paginatedQueryOptions.offset,
    queryToPerform: (limit, offset) =>
      queryChannelsOnAppAsync(graphqlClient, { appId: projectId, limit, offset }),
    promptOptions: {
      title: selectionPromptTitle,
      makePartialChoiceObject: updateChannel => ({ title: updateChannel.name }),
      getIdentifierForQueryItem: updateChannel => updateChannel.id,
    },
  });

  if (!updateChannel) {
    throw new Error(`Could not find any channels for app "${projectId}"`);
  }
  return updateChannel;
}

export async function listAndRenderChannelsOnAppAsync(
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
    const channels = await queryChannelsOnAppAsync(graphqlClient, {
      appId: projectId,
      limit: paginatedQueryOptions.limit ?? CHANNELS_LIMIT,
      offset: paginatedQueryOptions.offset,
    });
    renderPageOfChannels(channels, paginatedQueryOptions);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? CHANNELS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryChannelsOnAppAsync(graphqlClient, { limit, offset, appId: projectId }),
      promptOptions: {
        title: 'Load more channels?',
        renderListItems: channels => renderPageOfChannels(channels, paginatedQueryOptions),
      },
    });
  }
}

export async function listAndRenderBranchesAndUpdatesOnChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId: appId,
    channelName,
    paginatedQueryOptions,
  }: {
    projectId: string;
    channelName: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, { appId, channelName });
  renderChannelHeaderContent({ channelName: channel.name, channelId: channel.id });

  if (paginatedQueryOptions.nonInteractive) {
    const branches = await queryBranchesAndUpdateGroupsOnChannelAsync(graphqlClient, {
      appId,
      channelName,
      offset: paginatedQueryOptions.offset,
      limit: paginatedQueryOptions.limit ?? CHANNELS_LIMIT,
    });
    renderPageOfBranchesOnChannel(channel, branches, paginatedQueryOptions);
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? CHANNELS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        queryBranchesAndUpdateGroupsOnChannelAsync(graphqlClient, {
          channelName,
          appId,
          offset,
          limit,
        }),
      promptOptions: {
        title: 'Load more channels?',
        renderListItems: branches =>
          renderPageOfBranchesOnChannel(channel, branches, paginatedQueryOptions),
      },
    });
  }
}

async function queryChannelsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, offset, limit }: ViewUpdateChannelsOnAppQueryVariables
): Promise<UpdateChannelObject[]> {
  return await ChannelQuery.viewUpdateChannelsOnAppAsync(graphqlClient, {
    appId,
    offset,
    limit,
  });
}

async function queryBranchesAndUpdateGroupsOnChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  args: ViewBranchesOnUpdateChannelQueryVariables
): Promise<UpdateBranchOnChannelObject[]> {
  return await BranchQuery.listBranchesOnChannelAsync(graphqlClient, args);
}

function renderPageOfChannels(
  currentPage: UpdateChannelObject[],
  { json }: PaginatedQueryOptions
): void {
  if (json) {
    printJsonOnlyOutput({ currentPage });
  } else {
    for (const channel of currentPage) {
      renderChannelHeaderContent({ channelName: channel.name, channelId: channel.id });
      Log.addNewLineIfNone();
      logChannelDetails(channel);

      if (currentPage.indexOf(channel) < currentPage.length - 1) {
        Log.log(`\n${chalk.dim('———')}\n`);
      }
    }
  }
}

function renderPageOfBranchesOnChannel(
  channel: UpdateChannelObject,
  currentPage: UpdateBranchOnChannelObject[],
  { json }: PaginatedQueryOptions
): void {
  const channelWithNewBranches = { ...channel, updateBranches: currentPage };
  if (json) {
    printJsonOnlyOutput({ currentPage: channelWithNewBranches });
  } else {
    // The channel details contain both the branch and latest update group
    Log.addNewLineIfNone();
    logChannelDetails(channelWithNewBranches);
  }
}

function renderChannelHeaderContent({
  channelName,
  channelId,
}: {
  channelName: string;
  channelId: string;
}): void {
  Log.addNewLineIfNone();
  Log.log(chalk.bold('Channel:'));
  Log.log(
    formatFields([
      { label: 'Name', value: channelName },
      { label: 'ID', value: channelId },
    ])
  );
  Log.addNewLineIfNone();
  Log.log(chalk`{bold Branches pointed at this channel and their most recent update group:}`);
}

export async function createChannelOnAppWithNoBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    channelName,
  }: {
    appId: string;
    channelName: string;
  }
): Promise<CreateUpdateChannelOnAppWithNoBranchMutation> {
  return await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        CreateUpdateChannelOnAppWithNoBranchMutation,
        CreateUpdateChannelOnAppWithNoBranchMutationVariables
      >(
        gql`
          mutation CreateUpdateChannelOnAppWithNoBranch($appId: ID!, $name: String!) {
            updateChannel {
              createUpdateChannelForApp(appId: $appId, name: $name) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        {
          appId,
          name: channelName,
        }
      )
      .toPromise()
  );
}

export async function createChannelOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchId,
    channelName,
  }: {
    appId: string;
    branchId: string;
    channelName: string;
  }
): Promise<CreateUpdateChannelOnAppMutation> {
  // Point the new channel at a branch with its same name.
  const branchMapping = JSON.stringify({
    data: [{ branchId, branchMappingLogic: 'true' }],
    version: 0,
  });
  return await withErrorHandlingAsync(
    graphqlClient
      .mutation<CreateUpdateChannelOnAppMutation, CreateUpdateChannelOnAppMutationVariables>(
        gql`
          mutation CreateUpdateChannelOnApp($appId: ID!, $name: String!, $branchMapping: String!) {
            updateChannel {
              createUpdateChannelForApp(appId: $appId, name: $name, branchMapping: $branchMapping) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        {
          appId,
          name: channelName,
          branchMapping,
        }
      )
      .toPromise()
  );
}

export async function ensureChannelExistsAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, branchId, channelName }: { appId: string; branchId: string; channelName: string }
): Promise<void> {
  try {
    await createChannelOnAppAsync(graphqlClient, {
      appId,
      channelName,
      branchId,
    });
  } catch (e: any) {
    const isIgnorableError =
      e.graphQLErrors?.length === 1 &&
      e.graphQLErrors[0].extensions.errorCode === 'CHANNEL_ALREADY_EXISTS';
    if (!isIgnorableError) {
      throw e;
    }
  }
}

export async function doesChannelExistAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, channelName }: { appId: string; channelName: string }
): Promise<boolean> {
  try {
    await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId,
      channelName,
    });
  } catch (err) {
    if (err instanceof ChannelNotFoundError) {
      return false;
    }
    throw err;
  }
  return true;
}

/**
 *
 * Creates a channel and links it to a branch with the same name.
 *
 * @param appId the app ID, also known as the project ID
 * @param channelName the name of the channel to create
 * @param shouldPrintJson print only the JSON output
 */
export async function createAndLinkChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    channelName,
    shouldPrintJson,
  }: { appId: string; channelName: string; shouldPrintJson?: boolean }
): Promise<ChannelBasicInfo> {
  let branchId: string;
  let branchMessage: string;

  try {
    const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
      appId,
      name: channelName,
    });
    branchId = branch.id;
    branchMessage = `We found a branch with the same name`;
  } catch (error) {
    if (error instanceof BranchNotFoundError) {
      const newBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
        appId,
        name: channelName,
      });
      branchId = newBranch.id;
      branchMessage = `We also went ahead and made a branch with the same name`;
    } else {
      throw error;
    }
  }

  const {
    updateChannel: { createUpdateChannelForApp: newChannel },
  } = await createChannelOnAppAsync(graphqlClient, {
    appId,
    channelName,
    branchId,
  });

  if (!newChannel) {
    throw new Error(
      `Could not create channel with name ${channelName} on project with id ${appId}`
    );
  }

  if (shouldPrintJson) {
    printJsonOnlyOutput(newChannel);
  } else {
    Log.addNewLineIfNone();
    Log.withTick(
      `Created a new channel on project ${chalk.bold(
        await getDisplayNameForProjectIdAsync(graphqlClient, appId)
      )}`
    );
    Log.log(
      formatFields([
        { label: 'Name', value: newChannel.name },
        { label: 'ID', value: newChannel.id },
      ])
    );
    Log.addNewLineIfNone();
    Log.withTick(`${branchMessage} and have pointed the channel at it.`);
    Log.log(
      formatFields([
        { label: 'Name', value: newChannel.name },
        { label: 'ID', value: branchId },
      ])
    );
  }
  return newChannel;
}

export async function updateChannelBranchMappingAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId, branchMapping }: UpdateChannelBranchMappingMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<UpdateChannelBranchMappingMutation, UpdateChannelBranchMappingMutationVariables>(
        gql`
          mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
            updateChannel {
              editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        { channelId, branchMapping }
      )
      .toPromise()
  );
  const channel = data.updateChannel.editUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}

export async function deleteChannelOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId }: DeleteUpdateChannelMutationVariables
): Promise<DeleteUpdateChannelResult> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<DeleteUpdateChannelMutation, DeleteUpdateChannelMutationVariables>(
        gql`
          mutation DeleteUpdateChannel($channelId: ID!) {
            updateChannel {
              deleteUpdateChannel(channelId: $channelId) {
                id
              }
            }
          }
        `,
        {
          channelId,
        }
      )
      .toPromise()
  );
  return data.updateChannel.deleteUpdateChannel;
}
