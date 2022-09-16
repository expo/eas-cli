import gql from 'graphql-tag';

import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateChannelMutation,
  DeleteUpdateChannelMutationVariables,
  DeleteUpdateChannelResult,
} from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
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

  async runAsync(): Promise<void> {
    const {
      args: { name: nameArg },
      flags,
    } = await this.parse(ChannelDelete);
    const { json: jsonFlag, 'non-interactive': nonInteractiveFlag } = flags;
    if (jsonFlag && !nonInteractiveFlag) {
      throw new Error('--json is allowed only in non-interactive mode');
    }
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    let channelId, channelName;
    if (nameArg) {
      const { id, name } = await ChannelQuery.viewUpdateChannelAsync({
        appId: projectId,
        channelName: nameArg,
      });
      channelId = id;
      channelName = name;
    } else {
      if (nonInteractiveFlag) {
        throw new Error('Channel name must be set when running in non-interactive mode');
      }
      const { id, name } = await selectChannelOnAppAsync({
        projectId,
        selectionPromptTitle: 'Select a channel to delete',
        paginatedQueryOptions: {
          json: jsonFlag,
          nonInteractive: nonInteractiveFlag,
          offset: 0,
        },
      });
      channelId = id;
      channelName = name;
    }

    if (!nonInteractiveFlag) {
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

    const deletionResult = await deleteChannelOnAppAsync({
      channelId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(deletionResult);
    } else {
      Log.withTick(`️Deleted channel "${channelName}".`);
    }
  }
}

async function deleteChannelOnAppAsync({
  channelId,
}: DeleteUpdateChannelMutationVariables): Promise<DeleteUpdateChannelResult> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<DeleteUpdateChannelMutation, DeleteUpdateChannelMutationVariables>(
        gql`
          mutation DeleteUpdateChannel($channelId: ID!) {
            updateChannel {
              deleteUpdateChannel(channelId: $channelId) {
                id
              }
            }
          }
        `,
        {
          channelId,
        }
      )
      .toPromise()
  );
  return data.updateChannel.deleteUpdateChannel;
}
