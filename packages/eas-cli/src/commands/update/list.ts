import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import Table from 'cli-table3';

import { getUpdatesAsync } from '../../../src/update/updateUtils';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

export default class UpdateList extends Command {
  static hidden = true;
  static description = 'View a list of updates.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to view',
    },
  ];

  static flags = {
    platform: flags.string({
      description: 'Platform-specifc updates to return: ios, android, or both.',
    }),
    json: flags.boolean({
      description: 'Return list of updates as JSON.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { releaseName },
      flags: { json: jsonFlag, platform: platformFlag },
    } = this.parse(UpdateList);

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

    if (!releaseName) {
      const validationMessage = 'Release name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ releaseName } = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please enter the name of the release to view:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const updates = await getUpdatesAsync({
      projectId,
      releaseName,
      platformFlag,
    });

    if (jsonFlag) {
      log(updates);
      return;
    }

    const updateGroupTable = new Table({
      head: ['Created at', 'Update message', 'Update group ID', 'Platforms'],
      wordWrap: true,
    });

    for (const update of updates) {
      updateGroupTable.push([
        new Date(update.createdAt).toLocaleString(),
        `[${update.actor?.username}] ${update.updateMessage}`,
        update.updateGroup,
        update.platforms,
      ]);
    }

    log(updateGroupTable.toString());
  }
}
