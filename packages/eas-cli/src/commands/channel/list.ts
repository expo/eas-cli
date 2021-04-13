import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetAllChannelsForAppQuery,
  GetAllChannelsForAppQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { UPDATE_COLUMNS, formatUpdate } from '../branch/list';

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
                  updateBranches(offset: 0, limit: 1) {
                    id
                    name
                    updates(offset: 0, limit: 1) {
                      id
                      group
                      message
                      runtimeVersion
                      createdAt
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
        { appId, offset: 0, limit: CHANNEL_LIMIT }
      )
      .toPromise()
  );
}

export default class ChannelList extends Command {
  static hidden = true;
  static description = 'List all channels on the current project.';

  static flags = {
    json: flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    const {
      flags: { json: jsonFlag },
    } = this.parse(ChannelList);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);
    const { slug } = exp;
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    const getAllUpdateChannelForAppResult = await getAllUpdateChannelForAppAsync({
      appId: projectId,
    });
    const channels = getAllUpdateChannelForAppResult.app?.byId.updateChannels;
    if (!channels) {
      throw new Error(`Could not find channels on project with id ${projectId}`);
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(channels));
      return;
    }

    const table = new Table({
      head: ['channel', 'branch', ...UPDATE_COLUMNS],
      wordWrap: true,
    });

    for (const channel of channels) {
      // TODO (cedric): refactor when multiple branches per channel are available
      const branch = channel.updateBranches[0];
      const update = branch.updates[0];

      table.push([
        channel.name,
        branch.name,
        formatUpdate(update),
        update?.runtimeVersion ?? 'N/A',
        update?.group ?? 'N/A',
      ]);
    }

    Log.log(chalk`{bold Channels with their branches and their most recent update group:}`);
    Log.log(table.toString());
  }
}
