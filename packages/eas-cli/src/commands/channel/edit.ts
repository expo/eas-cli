import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetChannelByNameToEditQuery,
  GetChannelByNameToEditQueryVariables,
  UpdateBranch,
  UpdateChannel,
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

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
        { appId, channelName }
      )
      .toPromise()
  );
  const updateChannelByNameResult = data.app?.byId.updateChannelByName;
  if (!updateChannelByNameResult) {
    throw new Error(`Could not find a channel named ${channelName} on app with id ${appId}`);
  }
  return updateChannelByNameResult;
}

async function updateChannelBranchMappingAsync({
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
    throw new Error(`Could not fine channel with id ${channelId}`);
  }
  return data.updateChannel.editUpdateChannel!;
}

export default class ChannelEdit extends Command {
  static hidden = true;
  static description = 'Point a channel at a new branch.';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to edit',
    },
  ];

  static flags = {
    branch: flags.string({
      description: 'Name of the branch to point to',
    }),
    json: flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { name: channelName },
      flags: { branch: branchName, json: jsonFlag },
    } = this.parse(ChannelEdit);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!channelName) {
      const validationMessage = 'A channel name is required to edit a specific channel.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: channelName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the channel to edit:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const existingChannel = await getChannelByNameForAppAsync({ appId: projectId, channelName });
    // todo: refactor when multiple branches per channel are available
    const existingBranch = existingChannel.updateBranches[0];

    Log.addNewLineIfNone();
    Log.log(
      chalk`Channel {bold ${existingChannel.name}} is currently set to branch {bold ${existingBranch.name}}`
    );
    Log.addNewLineIfNone();

    if (!branchName) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: branchName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: chalk`What branch should it change to?`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const branch = await getBranchByNameAsync({ appId: projectId, name: branchName! });

    const channel = await updateChannelBranchMappingAsync({
      channelId: existingChannel.id,
      // todo: move branch mapping logic to utility
      branchMapping: JSON.stringify({
        data: [{ branchId: branch.id, branchMappingLogic: 'true' }],
        version: 0,
      }),
    });

    if (jsonFlag) {
      Log.log(JSON.stringify(channel));
      return;
    }

    Log.withTick(
      chalk`Channel {bold ${channel.name}} is now set to branch {bold ${branch.name}}.\n`
    );
    Log.log(
      chalk`Users with builds on channel {bold ${channel.name}} will now receive the active update on {bold ${branch.name}}.`
    );
  }
}
