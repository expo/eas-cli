import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateChannel } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { createUpdateBranchOnAppAsync } from '../branch/create';

async function createUpdateChannelOnAppAsync({
  appId,
  name,
  branchId,
}: {
  appId: string;
  name: string;
  branchId: string;
}): Promise<UpdateChannel> {
  // Point the new channel at a branch with its same name.
  const branchMapping = JSON.stringify({
    data: [{ branchId, branchMappingLogic: 'true' }],
    version: 0,
  });
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateChannel: { createUpdateChannelForApp: UpdateChannel } },
        { appId: string; name: string; branchMapping: string }
      >(
        gql`
          mutation CreateUpdateChannelForApp($appId: ID!, $name: String!, $branchMapping: String!) {
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
          name,
          branchMapping,
        }
      )
      .toPromise()
  );
  return data.updateChannel.createUpdateChannelForApp;
}

export default class ChannelCreate extends Command {
  static hidden = true;
  static description = 'Create a channel on the current project.';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to create',
    },
  ];

  static flags = {
    json: flags.boolean({
      description:
        'print output as a JSON object with the new channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag },
    } = this.parse(ChannelCreate);

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
      const validationMessage = 'Channel name may not be empty.';
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

    let branchId: string;
    let branchMessage: string;
    try {
      const existingBranch = await getBranchByNameAsync({
        appId: projectId,
        name: channelName,
      });
      branchId = existingBranch.id;
      branchMessage = `We found a branch with the same name`;
    } catch (e) {
      const newBranch = await createUpdateBranchOnAppAsync({
        appId: projectId,
        name: channelName,
      });
      branchId = newBranch.id;
      branchMessage = `We also went ahead and made a branch with the same name`;
    }

    const newChannel = await createUpdateChannelOnAppAsync({
      appId: projectId,
      name: channelName,
      branchId,
    });

    if (jsonFlag) {
      Log.log(newChannel);
      return;
    }

    Log.withTick(
      `️Created a new channel ${chalk.bold(newChannel.name)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}. ${branchMessage} and have pointed the channel at it. You can now update your app by publishing!`
    );
  }
}
