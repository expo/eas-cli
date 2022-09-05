import { Flags } from '@oclif/core';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateChannelMutation,
  DeleteUpdateChannelMutationVariables,
  DeleteUpdateChannelResult,
  GetChannelInfoQuery,
  GetChannelInfoQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
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
    json: Flags.boolean({
      description: 'print output as a JSON object',
      default: false,
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: nameArg },
      flags: { json: jsonFlag, 'non-interactive': nonInteractiveFlag },
    } = await this.parse(ChannelDelete);
    if (jsonFlag && !nonInteractiveFlag) {
      throw new Error('--json is allowed only in non-interactive mode');
    }
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const fullName = await getProjectFullNameAsync(exp);
    const projectId = await getProjectIdAsync(exp);

    let name;
    if (nameArg) {
      name = nameArg;
    } else {
      if (nonInteractiveFlag) {
        throw new Error('Channel name must be set when running in non-interactive mode');
      }
      name = (
        await promptAsync({
          type: 'text',
          name: 'name',
          message: 'Provide the name of the channel to delete:',
          validate: (value: any) => (value ? true : 'Channel name may not be empty.'),
        })
      ).name;
    }

    const data = await getChannelInfoAsync({ appId: projectId, name });
    const channelId = data.app?.byId.updateChannelByName?.id;
    if (!channelId) {
      throw new Error(`Could not find channel ${name} on ${fullName}`);
    }

    if (!nonInteractiveFlag) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete channel: "${name}".\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        Log.error(`Canceled deletion of channel: "${name}".`);
        process.exit(1);
      }
    }

    const deletionResult = await deleteChannelOnAppAsync({
      channelId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(deletionResult);
    } else {
      Log.withTick(`️Deleted channel "${name}".`);
    }
  }
}

async function getChannelInfoAsync({
  appId,
  name,
}: GetChannelInfoQueryVariables): Promise<GetChannelInfoQuery> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<GetChannelInfoQuery, GetChannelInfoQueryVariables>(
        gql`
          query GetChannelInfo($appId: String!, $name: String!) {
            app {
              byId(appId: $appId) {
                id
                updateChannelByName(name: $name) {
                  id
                  name
                }
              }
            }
          }
        `,
        {
          appId,
          name,
        },
        { additionalTypenames: ['UpdateChannel'] }
      )
      .toPromise()
  );
  return data;
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
