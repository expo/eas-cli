import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';

import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

export default class ChannelView extends Command {
  static hidden = true;
  static description = 'View a channel on the current project.';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to view',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: 'print output as a JSON object with the channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag },
    } = this.parse(ChannelView);

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
      const validationMessage = 'A channel name is required to view a specific channel.';
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

    const channel = await ChannelQuery.byNameForAppAsync({
      appId: projectId,
      name: channelName,
    });

    if (jsonFlag) {
      Log.log(JSON.stringify(channel));
      return;
    }

    const table = new Table({
      head: ['channel', 'branch', 'update', 'message', 'created-at', 'actor'],
      wordWrap: true,
    });

    for (const branch of channel.updateBranches) {
      const update = branch.updates[0] || {};
      table.push([
        channel.name,
        branch.name,
        update.group,
        update.message,
        update.createdAt && new Date(update.createdAt).toLocaleString(),
        update.actor?.firstName,
      ]);
    }

    Log.withTick(
      chalk`Channel: {bold ${channel.name}} on project {bold ${accountName}/${slug}}. Channel ID: {bold ${channel.id}}`
    );
    Log.log(chalk`{bold Recent update groups published on this branch:}`);
    Log.log(table.toString());
  }
}
