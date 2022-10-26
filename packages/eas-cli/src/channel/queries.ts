import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import {
  ViewBranchesOnUpdateChannelQueryVariables,
  ViewUpdateChannelsOnAppQueryVariables,
} from '../graphql/generated';
import { BranchQuery, UpdateBranchOnChannelObject } from '../graphql/queries/BranchQuery';
import { ChannelQuery, UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
import { logChannelDetails } from './utils';

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
      createDisplayTextForSelectionPromptListItem: updateChannel => updateChannel.name,
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
