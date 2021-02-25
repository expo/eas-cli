import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';

import { ChannelMutation } from '../../graphql/mutations/ChannelMutation';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

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

    const branch = await getBranchByNameAsync({
      appId: projectId,
      name: branchName!,
    });

    const { id: channelId } = await ChannelQuery.byNameForAppAsync({
      appId: projectId,
      name: channelName,
    });

    const channel = await ChannelMutation.updateBranchMappingAsync({
      channelId,
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
