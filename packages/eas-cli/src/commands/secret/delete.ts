import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';

import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import {
  EnvironmentSecretWithScope,
  EnvironmentSecretsQuery,
} from '../../graphql/queries/EnvironmentSecretsQuery';
import Log from '../../log';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';
import { EnvironmentSecretScope } from './create';

export default class EnvironmentSecretDelete extends Command {
  static description = `Delete an environment secret by ID.
Unsure where to find the secret's ID? Run ${chalk.bold('eas secrets:list')}`;

  static flags = {
    id: flags.string({
      description: 'ID of the secret to delete',
    }),
  };

  async run() {
    await ensureLoggedInAsync();

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const projectFullName = await getProjectFullNameAsync(exp);
    const projectAccountName = await getProjectAccountNameAsync(exp);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    let {
      flags: { id },
    } = this.parse(EnvironmentSecretDelete);
    let secret: EnvironmentSecretWithScope | undefined;

    if (!id) {
      const validationMessage = 'You must select which secret to delete.';

      const secrets = await EnvironmentSecretsQuery.allAsync(projectAccountName, projectFullName);

      ({ secret } = await promptAsync({
        type: 'autocomplete',
        name: 'secret',
        message: 'Pick the secret to be deleted:',
        choices: secrets.map(secret => ({
          title: `${secret.name} (${secret.scope})`,
          value: secret,
        })),
      }));

      id = secret?.id;

      if (!id) throw new Error(validationMessage);
    }

    Log.addNewLineIfNone();
    Log.warn(
      `You are about to permamently delete secret${
        secret?.name ? ` "${secret?.name}"` : ''
      } with id: "${id}".\nThis action is irreversible.`
    );
    Log.newLine();
    const confirmed = await toggleConfirmAsync({
      message: `Are you sure you wish to proceed?${
        secret?.scope === EnvironmentSecretScope.ACCOUNT
          ? ' This secret is applied across your whole account and may affect multiple apps.'
          : ''
      }`,
    });
    if (!confirmed) {
      Log.error(
        `Canceled deletion of secret${secret?.name ? ` "${secret?.name}"` : ''} with id: "${id}".`
      );
      process.exit(1);
    }

    await EnvironmentSecretMutation.delete(id);

    Log.withTick(`️Deleted secret${secret?.name ? ` "${secret?.name}"` : ''} with id "${id}".`);
  }
}
