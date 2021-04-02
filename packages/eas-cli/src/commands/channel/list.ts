import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Actor,
  GetAllChannelsForAppQuery,
  GetAllChannelsForAppQueryVariables,
  Update,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';

const CHANNEL_LIMIT = 10_000;

// TODO(cedric): refactor and reuse original code from channel view commands
type BranchMapping = {
  version: number;
  data: {
    branchId: string;
    branchMappingLogic: {
      operand: number;
      clientKey: string;
      branchMappingOperator: string;
    } & string;
  }[];
};

/**
 * Get the branch mapping and determine whether it is a rollout.
 * Ensure that the branch mapping is properly formatted.
 */
function getBranchMapping(
  branchMappingString: string
): { branchMapping: BranchMapping; isRollout: boolean; rolloutPercent?: number } {
  if (!branchMappingString) {
    throw new Error('Missing branch mapping.');
  }

  const branchMapping: BranchMapping = JSON.parse(branchMappingString);
  if (branchMapping.version !== 0) {
    throw new Error('Branch mapping must be version 0.');
  }

  const isRollout = branchMapping.data.length === 2;
  const rolloutPercent = branchMapping.data[0].branchMappingLogic.operand;

  switch (branchMapping.data.length) {
    case 0:
      break;
    case 1:
      if (branchMapping.data[0].branchMappingLogic !== 'true') {
        throw new Error('Branch mapping logic for a single branch must be "true"');
      }
      break;
    case 2:
      if (branchMapping.data[0].branchMappingLogic.clientKey !== 'rolloutToken') {
        throw new Error('Client key of initial branch mapping must be "rolloutToken"');
      }
      if (branchMapping.data[0].branchMappingLogic.branchMappingOperator !== 'hash_lt') {
        throw new Error('Branch mapping operator of initial branch mapping must be "hash_lt"');
      }
      if (!rolloutPercent) {
        throw new Error('Branch mapping is missing a "rolloutPercent"');
      }
      if (branchMapping.data[1].branchMappingLogic !== 'true') {
        throw new Error('Branch mapping logic for a the second branch of a rollout must be "true"');
      }
      break;
    default:
      throw new Error('Branch mapping data must have length less than or equal to 2.');
  }

  return { branchMapping, isRollout, rolloutPercent };
}

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
                  createdAt
                  branchMapping
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
      head: ['channel', 'branch', 'update', 'message', 'created-at', 'actor'],
      wordWrap: true,
    });

    for (const channel of channels) {
      const { branchMapping, isRollout, rolloutPercent } = getBranchMapping(channel.branchMapping);
      const rolloutMapping: string[] = [];
      let update:
        | null
        | (Omit<Partial<Update>, 'actor'> & {
            actor?: null | Pick<Actor, 'id' | 'firstName'>;
          }) = null;

      for (const index in branchMapping.data) {
        if (parseInt(index, 10) > 1) {
          throw new Error('Branch Mapping data must have length less than or equal to 2.');
        }

        const { branchId } = branchMapping.data[index];
        const branch = channel.updateBranches.find(branch => branch.id === branchId);
        if (!branch) {
          throw new Error('Branch mapping is pointing at a missing branch.');
        }

        if (!isRollout) {
          rolloutMapping.push(branch.name);
        } else {
          rolloutMapping.push(
            parseInt(index, 10) === 0
              ? `${branch.name} (${rolloutPercent! * 100}%)`
              : `${branch.name} (${(1 - rolloutPercent!) * 100}%)`
          );
        }

        update = branch.updates[0];
      }

      table.push([
        channel.name,
        rolloutMapping.join(' /\n'),
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
