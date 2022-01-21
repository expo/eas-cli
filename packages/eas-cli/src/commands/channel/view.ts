import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetChannelByNameForAppQuery,
  GetChannelByNameForAppQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import {
  FormatUpdateParameter,
  UPDATE_COLUMNS,
  formatUpdate,
  getPlatformsForGroup,
} from '../../update/utils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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
export function getBranchMapping(branchMappingString?: string): {
  branchMapping: BranchMapping;
  isRollout: boolean;
  rolloutPercent?: number;
} {
  if (!branchMappingString) {
    throw new Error('Missing branch mapping.');
  }
  let branchMapping: BranchMapping;
  try {
    branchMapping = JSON.parse(branchMappingString);
  } catch (e) {
    throw new Error(`Could not parse branchMapping string into a JSON: "${branchMappingString}"`);
  }
  assert(branchMapping, 'Branch Mapping must be defined.');

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
        { appId, channelName },
        { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
      )
      .toPromise()
  );
}

export function logChannelDetails(channel: {
  branchMapping: string;
  updateBranches: {
    updates: (FormatUpdateParameter & {
      runtimeVersion: string;
      group: string;
      platform: string;
    })[];
    name: string;
    id: string;
  }[];
}): void {
  const { branchMapping, isRollout, rolloutPercent } = getBranchMapping(channel.branchMapping);

  const table = new Table({
    head: ['branch', ...(isRollout ? ['rollout percent'] : []), ...UPDATE_COLUMNS],
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
      formatUpdate(update),
      update?.runtimeVersion ?? 'N/A',
      update?.group ?? 'N/A',
      getPlatformsForGroup({
        updates: branch.updates,
        group: branch.updates[0]?.group,
      }),
    ]);
  }
  Log.log(table.toString());
}

export default class ChannelView extends EasCommand {
  static description = 'view a channel';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to view',
    },
  ];

  static flags = {
    json: Flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag },
    } = await this.parse(ChannelView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

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
      throw new Error(`Could not find a channel with name: ${channelName}`);
    }

    if (jsonFlag) {
      printJsonOnlyOutput(channel);
    } else {
      Log.addNewLineIfNone();
      Log.log(chalk.bold('Channel:'));
      Log.log(
        formatFields([
          { label: 'Name', value: channel.name },
          { label: 'ID', value: channel.id },
        ])
      );
      Log.addNewLineIfNone();
      Log.log(chalk`{bold Branches pointed at this channel and their most recent update group:}`);
      logChannelDetails(channel);
    }
  }
}
