import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import {
  EnvironmentSecretScope,
  EnvironmentSecretWithScope,
  EnvironmentSecretsQuery,
} from '../../graphql/queries/EnvironmentSecretsQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

export default class EnvironmentSecretDelete extends EasCommand {
  static description = 'delete an environment secret by ID';

  static flags = {
    id: Flags.string({
      description: 'ID of the secret to delete',
    }),
  };

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const projectAccountName = await getProjectAccountNameAsync(exp);

    let {
      flags: { id },
    } = await this.parse(EnvironmentSecretDelete);
    let secret: EnvironmentSecretWithScope | undefined;

    if (!id) {
      const validationMessage = 'You must select which secret to delete.';

      const secrets = await EnvironmentSecretsQuery.allAsync(projectAccountName, projectId);

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

      if (!id) {
        throw new Error(validationMessage);
      }
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

    await EnvironmentSecretMutation.deleteAsync(id);

    Log.withTick(`️Deleted secret${secret?.name ? ` "${secret?.name}"` : ''} with id "${id}".`);
  }
}
