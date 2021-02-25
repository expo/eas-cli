import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateBranch, UpdateChannel } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

async function getChannelAndBranchByNameForAppAsync(variables: {
  appId: string;
  channelName: string;
  branchName: string;
}): Promise<{
  channel: UpdateChannel;
  branch: UpdateBranch;
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query(
        gql`
          query GetChannelByNameForApp(
            $appId: String!
            $channelName: String!
            $branchName: String!
          ) {
            app {
              byId(appId: $appId) {
                id
                updateChannelByName(name: $channelName) {
                  id
                  name
                }
                updateBranchByName(name: $branchName) {
                  id
                  name
                }
              }
            }
          }
        `,
        variables
      )
      .toPromise()
  );
  return {
    channel: data.app.byId.updateChannelByName,
    branch: data.app.byId.updateBranchByName,
  };
}

async function updateChannelBranchMappingAsync(variables: {
  channelId: string;
  branchMapping: string;
}): Promise<UpdateChannel> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation(
        gql`
          mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
            updateChannel {
              editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                id
                name
                createdAt
                branchMapping
                updateBranches(offset: 0, limit: 25) {
                  id
                  name
                }
              }
            }
          }
        `,
        variables
      )
      .toPromise()
  );
  return data.updateChannel.editUpdateChannel;
}

export default class ChannelEdit extends Command {
  static hidden = true;
  static description = 'Edit a channel on the current project.';

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
        message: 'Please name the channel:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!branchName) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: branchName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'What branch should it change to?',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const {
      branch,
      channel: { id: channelId },
    } = await getChannelAndBranchByNameForAppAsync({
      appId: projectId,
      branchName: branchName!,
      channelName,
    });

    const channel = await updateChannelBranchMappingAsync({
      channelId,
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
