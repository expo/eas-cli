import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateChannel } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';

const CHANNEL_LIMIT = 10_000;

async function getAllUpdateChannelForAppAsync({
  appId,
  limit = CHANNEL_LIMIT,
}: {
  appId: string;
}): Promise<UpdateChannel[]> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query(
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
                      createdAt
                      actor {
                        id
                        ... on User {
                          firstName
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
        { appId, limit: CHANNEL_LIMIT }
      )
      .toPromise()
  );
  return data.app.byId.updateChannels;
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
    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    const channels = await getAllUpdateChannelForAppAsync({ appId: projectId });

    if (jsonFlag) {
      Log.log(JSON.stringify(channels));
      return;
    }

    const table = new Table({
      head: ['channel', 'branch', 'update', 'message', 'created-at', 'actor'],
      wordWrap: true,
    });

    for (const channel of channels) {
      // TODO (cedric): refactor when multiple branches per channel are available
      const branch = channel.updateBranches[0];
      const update = branch.updates[0];

      table.push([
        channel.name,
        branch.name,
        update?.group,
        update?.message,
        update?.createdAt && new Date(update.createdAt).toLocaleString(),
        update?.actor?.firstName,
      ]);
    }

    Log.log(chalk`{bold Channels for this app:}`);
    Log.log(table.toString());
  }
}
