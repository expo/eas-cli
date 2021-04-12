import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetChannelByNameForAppQuery,
  GetChannelByNameForAppQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

export type BranchMapping = {
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
export function getBranchMapping(
  getChannelByNameForAppQuery: GetChannelByNameForAppQuery
): { branchMapping: BranchMapping; isRollout: boolean; rolloutPercent?: number } {
  const branchMappingString =
    getChannelByNameForAppQuery.app?.byId.updateChannelByName?.branchMapping;
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
      if (rolloutPercent == null) {
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

export async function getUpdateChannelByNameForAppAsync({
  appId,
  channelName,
}: GetChannelByNameForAppQueryVariables): Promise<GetChannelByNameForAppQuery> {
  return await withErrorHandlingAsync(
    graphqlClient
      .query<GetChannelByNameForAppQuery, GetChannelByNameForAppQueryVariables>(
        gql`
          query GetChannelByNameForApp($appId: String!, $channelName: String!) {
            app {
              byId(appId: $appId) {
                id
                updateChannelByName(name: $channelName) {
                  id
                  name
                  createdAt
                  branchMapping
                  updateBranches(offset: 0, limit: 1000) {
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
        { appId, channelName }
      )
      .toPromise()
  );
}

export default class ChannelView extends Command {
  static hidden = true;
  static description = 'View a channel on the current project.';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to view',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag },
    } = this.parse(ChannelView);

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

    if (!channelName) {
      const validationMessage = 'A channel name is required to view a specific channel.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: channelName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please name the channel:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const getUpdateChannelByNameForAppresult = await getUpdateChannelByNameForAppAsync({
      appId: projectId,
      channelName,
    });
    const channel = getUpdateChannelByNameForAppresult.app?.byId.updateChannelByName;
    if (!channel) {
      throw new Error(`Could not fine channel with name ${channelName}`);
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(channel));
      return;
    }

    const { branchMapping, isRollout, rolloutPercent } = getBranchMapping(
      getUpdateChannelByNameForAppresult
    );

    const table = new Table({
      head: [
        'branch',
        ...(isRollout ? ['rollout percent'] : []),
        'active update group',
        'update message',
        'last publish',
        'actor',
      ],
      wordWrap: true,
    });

    for (const index in branchMapping.data) {
      if (parseInt(index, 10) > 1) {
        throw new Error('Branch Mapping data must have length less than or equal to 2.');
      }

      const { branchId } = branchMapping.data[index];
      const branch = channel.updateBranches.filter(branch => branch.id === branchId)[0];
      if (!branch) {
        throw new Error('Branch mapping is pointing at a missing branch.');
      }
      const update = branch.updates[0];
      table.push([
        branch.name,
        ...(isRollout
          ? [
              parseInt(index, 10) === 0
                ? `${rolloutPercent! * 100}%`
                : `${(1 - rolloutPercent!) * 100}%`,
            ]
          : []),
        update?.group,
        update?.message,
        update?.createdAt && new Date(update.createdAt).toLocaleString(),
        update?.actor?.firstName,
      ]);
    }

    Log.withTick(
      chalk`Channel: {bold ${channel.name}} on project {bold ${accountName}/${slug}}. Channel ID: {bold ${channel.id}}`
    );
    Log.log(chalk`{bold Recent update groups published on this branch:}`);
    Log.log(table.toString());
  }
}
