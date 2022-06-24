import { Flags } from '@oclif/core';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetAllChannelsForAppQuery,
  GetAllChannelsForAppQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';
import { BRANCHES_LIMIT } from '../branch/list';
import { logChannelDetails } from './view';

const CHANNEL_LIMIT = 50;

async function getAllUpdateChannelForAppAsync({
  appId,
  channelLimit = CHANNEL_LIMIT,
  channelOffset = 0,
  branchLimit = BRANCHES_LIMIT,
  branchOffset = 0,
}: GetAllChannelsForAppQueryVariables): Promise<GetAllChannelsForAppQuery> {
  return await withErrorHandlingAsync(
    graphqlClient
      .query<GetAllChannelsForAppQuery, GetAllChannelsForAppQueryVariables>(
        gql`
          query GetAllChannelsForApp(
            $appId: String!
            $channelOffset: Int!
            $channelLimit: Int!
            $branchLimit: Int!
            $branchOffset: Int!
          ) {
            app {
              byId(appId: $appId) {
                id
                updateChannels(offset: $channelOffset, limit: $channelLimit) {
                  id
                  name
                  branchMapping
                  updateBranches(offset: $branchOffset, limit: $branchLimit) {
                    id
                    name
                    updates(offset: 0, limit: 1) {
                      id
                      group
                      message
                      runtimeVersion
                      createdAt
                      platform
                      actor {
                        id
                        ... on User {
                          username
                        }
                        ... on Robot {
                          firstName
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { appId, channelOffset, channelLimit, branchLimit, branchOffset },
        { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
      )
      .toPromise()
  );
}

export default class ChannelList extends EasCommand {
  static description = 'list all channels';

  static flags = {
    json: Flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: { json: jsonFlag },
    } = await this.parse(ChannelList);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    await queryForChannelsAsync(projectId, jsonFlag);
  }
}

type UpdateChannelObject = GetAllChannelsForAppQuery['app']['byId']['updateChannels'][0];

async function queryForChannelsAsync(projectId: string, jsonFlag: boolean): Promise<void> {
  const queryToPerformAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<UpdateChannelObject>> => {
    let queriedAllBranches = false;
    let branchOffset = 0;
    const branchLimit = 10;
    const paginatedQuery: PaginatedQueryResponse<UpdateChannelObject> = {
      queryResponse: [],
      queryResponseRawLength: 0,
    };
    const branchesForChannels: Record<string, UpdateChannelObject['updateBranches']> = {};

    // we need to paginate our paginated query. Each channel (N) can have M branches
    // and we need to fetch all branches to populate our 'branch mapping' portion
    // of the UI properly.
    do {
      const getAllUpdateChannelForAppResult = await getAllUpdateChannelForAppAsync({
        appId: projectId,
        channelLimit: pageSize,
        channelOffset: offset,
        branchLimit,
        branchOffset,
      });
      const channels = getAllUpdateChannelForAppResult.app?.byId.updateChannels;
      if (!channels) {
        throw new Error(`Could not find channels on project with id ${projectId}`);
      }
      queriedAllBranches = true;
      // save each array of branches using a record so we can lookup in O(1) later on
      channels.forEach(channel => {
        if (channel.updateBranches.length === branchLimit) {
          queriedAllBranches = false;
        }

        branchesForChannels[channel.id] = [
          ...(branchesForChannels[channel.id] ? branchesForChannels[channel.id] : []),
          ...channel.updateBranches,
        ];
      });

      if (!paginatedQuery.queryResponse.length) {
        paginatedQuery.queryResponse = channels;
      } else {
        paginatedQuery.queryResponse.forEach(channel => {
          channel.updateBranches = branchesForChannels[channel.id];
        });
      }

      paginatedQuery.queryResponseRawLength = channels.length;
      branchOffset += branchLimit + 1;
    } while (!queriedAllBranches);

    return paginatedQuery;
  };

  const renderListItems = (currentPage: UpdateChannelObject[]): void => {
    if (jsonFlag) {
      printJsonOnlyOutput(currentPage);
    } else {
      Log.addNewLineIfNone();
      Log.log(chalk.bold('Channels:'));
      Log.addNewLineIfNone();
      for (const channel of currentPage) {
        Log.addNewLineIfNone();
        Log.log(
          formatFields([
            { label: 'Name', value: channel.name },
            { label: 'ID', value: channel.id },
          ])
        );
        logChannelDetails(channel);
      }
    }
  };

  await performPaginatedQueryAsync({
    pageSize: 25, // lower, because we need to query all branches per channel O(N*M)
    offset: 0,
    queryToPerform: queryToPerformAsync,
    promptOptions: {
      type: 'confirm',
      title: 'Fetch next page of channels?',
      renderListItems,
    },
  });
}
