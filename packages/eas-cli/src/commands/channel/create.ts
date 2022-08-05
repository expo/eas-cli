import { Flags } from '@oclif/core';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  CreateUpdateChannelOnAppMutation,
  CreateUpdateChannelOnAppMutationVariables,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { createUpdateBranchOnAppAsync } from '../branch/create';

export async function createUpdateChannelOnAppAsync({
  appId,
  channelName,
  branchId,
}: {
  appId: string;
  channelName: string;
  branchId: string;
}): Promise<CreateUpdateChannelOnAppMutation> {
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
                name
                branchMapping
              }
            }
          }
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

export default class ChannelCreate extends EasCommand {
  static description = 'create a channel';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to create',
    },
  ];

  static flags = {
    json: Flags.boolean({
      description:
        'print output as a JSON object with the new channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag },
    } = await this.parse(ChannelCreate);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    if (!channelName) {
      const validationMessage = 'Channel name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: channelName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Provide a channel name:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    let branchId: string;
    let branchMessage: string;
    const existingBranch = await BranchQuery.getBranchByNameAsync({
      appId: projectId,
      name: channelName,
    });

    if (existingBranch) {
      branchId = existingBranch.id;
      branchMessage = `We found a branch with the same name`;
    } else {
      const newBranch = await createUpdateBranchOnAppAsync({
        appId: projectId,
        name: channelName,
      });
      branchId = newBranch.id;
      branchMessage = `We also went ahead and made a branch with the same name`;
    }

    const {
      updateChannel: { createUpdateChannelForApp: newChannel },
    } = await createUpdateChannelOnAppAsync({
      appId: projectId,
      channelName,
      branchId,
    });

    if (!newChannel) {
      throw new Error(
        `Could not create channel with name ${channelName} on app with id ${projectId}`
      );
    }

    if (jsonFlag) {
      printJsonOnlyOutput(newChannel);
    } else {
      Log.addNewLineIfNone();
      Log.withTick(
        `Created a new channel on project ${chalk.bold(await getProjectFullNameAsync(exp))}`
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

      Log.addNewLineIfNone();
      Log.log(chalk.bold('You can now update your app by publishing!'));
    }
  }
}
