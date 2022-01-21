import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetAllChannelsForAppQuery,
  GetAllChannelsForAppQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { logChannelDetails } from './view';

const CHANNEL_LIMIT = 10_000;

async function getAllUpdateChannelForAppAsync({
  appId,
}: {
  appId: string;
}): Promise<GetAllChannelsForAppQuery> {
  return await withErrorHandlingAsync(
    graphqlClient
      .query<GetAllChannelsForAppQuery, GetAllChannelsForAppQueryVariables>(
        gql`
          query GetAllChannelsForApp($appId: String!, $offset: Int!, $limit: Int!) {
            app {
              byId(appId: $appId) {
                id
                updateChannels(offset: $offset, limit: $limit) {
                  id
                  name
                  branchMapping
                  updateBranches(offset: 0, limit: $limit) {
                    id
                    name
                    updates(offset: 0, limit: 10) {
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
        { appId, offset: 0, limit: CHANNEL_LIMIT },
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
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const getAllUpdateChannelForAppResult = await getAllUpdateChannelForAppAsync({
      appId: projectId,
    });
    const channels = getAllUpdateChannelForAppResult.app?.byId.updateChannels;
    if (!channels) {
      throw new Error(`Could not find channels on project with id ${projectId}`);
    }

    if (jsonFlag) {
      printJsonOnlyOutput(channels);
    } else {
      for (const channel of channels) {
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
  }
}
