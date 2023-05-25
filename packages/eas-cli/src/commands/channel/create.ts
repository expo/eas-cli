import chalk from 'chalk';

import { createUpdateBranchOnAppAsync } from '../../branch/queries';
import { BranchNotFoundError } from '../../branch/utils';
import { createChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ChannelCreate extends EasCommand {
  static override description = 'create a channel';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to create',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelCreate);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelCreate, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!channelName) {
      const validationMessage = 'Channel name may not be empty.';
      if (nonInteractive) {
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

    try {
      const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
        appId: projectId,
        name: channelName,
      });
      branchId = branch.id;
      branchMessage = `We found a branch with the same name`;
    } catch (error) {
      if (error instanceof BranchNotFoundError) {
        const newBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
          appId: projectId,
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
      appId: projectId,
      channelName,
      branchId,
    });

    if (!newChannel) {
      throw new Error(
        `Could not create channel with name ${channelName} on project with id ${projectId}`
      );
    }

    if (jsonFlag) {
      printJsonOnlyOutput(newChannel);
    } else {
      Log.addNewLineIfNone();
      Log.withTick(
        `Created a new channel on project ${chalk.bold(
          await getDisplayNameForProjectIdAsync(graphqlClient, projectId)
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

      Log.addNewLineIfNone();
      Log.log(chalk.bold('You can now update your app by publishing!'));
    }
  }
}
