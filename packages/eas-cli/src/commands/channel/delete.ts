import { deleteChannelOnAppAsync, selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { toggleConfirmAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ChannelDelete extends EasCommand {
  static override hidden = true;
  static override description = 'Delete a channel';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to delete',
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
    const {
      args: { name: nameArg },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelDelete);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelDelete, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    let channelId, channelName;
    if (nameArg) {
      const { id, name } = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
        appId: projectId,
        channelName: nameArg,
      });
      channelId = id;
      channelName = name;
    } else {
      if (nonInteractive) {
        throw new Error('Channel name must be set when running in non-interactive mode');
      }
      const { id, name } = await selectChannelOnAppAsync(graphqlClient, {
        projectId,
        selectionPromptTitle: 'Select a channel to delete',
        paginatedQueryOptions: {
          json: jsonFlag,
          nonInteractive,
          offset: 0,
        },
      });
      channelId = id;
      channelName = name;
    }

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete channel: "${channelName}".\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        Log.error(`Canceled deletion of channel: "${channelName}".`);
        process.exit(1);
      }
    }

    const deletionResult = await deleteChannelOnAppAsync(graphqlClient, {
      channelId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(deletionResult);
    } else {
      Log.withTick(`Deleted channel "${channelName}".`);
    }
  }
}
