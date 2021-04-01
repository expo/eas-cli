import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import chalk from 'chalk';

import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import Log from '../../log';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { toggleConfirmAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

export default class EnvironmentSecretDelete extends Command {
  static description = `Delete an environment secret by ID.
Unsure where to find the secret's ID? Run ${chalk.bold('eas secrets:list')}`;

  static args = [
    {
      name: 'id',
      required: true,
      description: `ID of the secret to delete`,
    },
  ];

  async run() {
    await ensureLoggedInAsync();

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    const {
      args: { id },
    } = this.parse(EnvironmentSecretDelete);

    Log.addNewLineIfNone();
    Log.warn(
      `You are about to permamently delete secret with id: "${id}".\nThis action is irreversible.`
    );
    Log.newLine();
    const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
    if (!confirmed) {
      Log.error(`Canceled deletion of secret with id: "${id}".`);
      process.exit(1);
    }

    await EnvironmentSecretMutation.delete(id);

    Log.withTick(`️Deleted secret with id "${id}".`);
  }
}
