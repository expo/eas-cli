import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetChannelByNameToEditQuery,
  GetChannelByNameToEditQueryVariables,
  UpdateBranch,
  UpdateChannel,
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

async function getChannelByNameForAppAsync({
  appId,
  channelName,
}: GetChannelByNameToEditQueryVariables): Promise<
  Pick<UpdateChannel, 'id' | 'name'> & {
    updateBranches: Pick<UpdateBranch, 'id' | 'name'>[];
  }
> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<GetChannelByNameToEditQuery, GetChannelByNameToEditQueryVariables>(
        gql`
          query GetChannelByNameToEdit($appId: String!, $channelName: String!) {
            app {
              byId(appId: $appId) {
                id
                updateChannelByName(name: $channelName) {
                  id
                  name
                  updateBranches(offset: 0, limit: 1) {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        { appId, channelName },
        { additionalTypenames: ['UpdateChannel', 'UpdateBranch'] }
      )
      .toPromise()
  );
  const updateChannelByNameResult = data.app?.byId.updateChannelByName;
  if (!updateChannelByNameResult) {
    throw new Error(`Could not find a channel named ${channelName} on app with id ${appId}`);
  }
  return updateChannelByNameResult;
}

export async function updateChannelBranchMappingAsync({
  channelId,
  branchMapping,
}: UpdateChannelBranchMappingMutationVariables): Promise<{
  id: string;
  name: string;
  branchMapping: string;
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<UpdateChannelBranchMappingMutation, UpdateChannelBranchMappingMutationVariables>(
        gql`
          mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
            updateChannel {
              editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                id
                name
                branchMapping
              }
            }
          }
        `,
        { channelId, branchMapping }
      )
      .toPromise()
  );
  const channel = data.updateChannel.editUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return data.updateChannel.editUpdateChannel!;
}

export default class ChannelEdit extends EasCommand {
  static description = 'point a channel at a new branch';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to edit',
    },
  ];

  static flags = {
    branch: Flags.string({
      description: 'Name of the branch to point to',
    }),
    json: Flags.boolean({
      description: 'Print output as a JSON object with the channel ID, name and branch mapping',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(ChannelEdit);
    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const channelName = args.name ?? (await promptForChannelAsync());

    const existingChannel = await getChannelByNameForAppAsync({ appId: projectId, channelName });
    if (existingChannel.updateBranches.length > 1) {
      throw new Error(
        'There is a rollout in progress. Please manage it with "channel:rollout" instead.'
      );
    }

    const branchName = flags.branch ?? (await promptForBranchAsync());

    const branch = await BranchQuery.getBranchByNameAsync({
      appId: projectId,
      name: branchName,
    });
    if (!branch) {
      throw new Error(
        `Could not find a branch named "${branchName}". Please check what branches exist on this project with ${chalk.bold(
          'eas branch:list'
        )}.`
      );
    }
    const channel = await updateChannelBranchMappingAsync({
      channelId: existingChannel.id,
      // todo: move branch mapping logic to utility
      branchMapping: JSON.stringify({
        data: [{ branchId: branch.id, branchMappingLogic: 'true' }],
        version: 0,
      }),
    });

    if (flags.json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(
        chalk`Channel {bold ${channel.name}} is now set to branch {bold ${branch.name}}.\n`
      );
      Log.addNewLineIfNone();
      Log.log(
        chalk`Users with builds on channel {bold ${channel.name}} will now receive the active update on {bold ${branch.name}}.`
      );
    }
  }
}

async function promptForChannelAsync(): Promise<string> {
  Log.addNewLineIfNone();
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Please enter the name of the channel to edit:',
    validate: value => (value ? true : 'A channel name is required to edit a specific channel.'),
  });
  return name;
}

async function promptForBranchAsync(): Promise<string> {
  Log.addNewLineIfNone();
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: `To which branch should the channel link?`,
    validate: value => (value ? true : 'branch name may not be empty.'),
  });
  return name;
}
