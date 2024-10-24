import chalk from 'chalk';

import { createAndLinkChannelAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { enableJsonOutput } from '../../utils/json';

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
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelCreate);
    const {
      projectId,
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

    await createAndLinkChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
      shouldPrintJson: jsonFlag,
    });

    Log.addNewLineIfNone();
    Log.log(chalk.bold('You can now update your app by publishing!'));
  }
}
