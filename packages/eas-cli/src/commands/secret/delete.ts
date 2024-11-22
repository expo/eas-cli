import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import {
  EnvironmentSecretScope,
  EnvironmentSecretWithScope,
  EnvironmentSecretsQuery,
} from '../../graphql/queries/EnvironmentSecretsQuery';
import Log from '../../log';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

export default class EnvironmentSecretDelete extends EasCommand {
  static override description = 'delete an environment secret by ID';
  static override hidden = true;

  static override flags = {
    id: Flags.string({
      description: 'ID of the secret to delete',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    Log.warn('This command is deprecated. Use eas env:delete instead.');
    Log.newLine();

    let {
      flags: { id, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentSecretDelete);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentSecretDelete, {
      nonInteractive,
    });
    let secret: EnvironmentSecretWithScope | undefined;

    if (!id) {
      const validationMessage = 'You must select which secret to delete.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

      const secrets = await EnvironmentSecretsQuery.allAsync(graphqlClient, projectId);
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

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete secret${
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
    }

    await EnvironmentSecretMutation.deleteAsync(graphqlClient, id);

    Log.withTick(`️Deleted secret${secret?.name ? ` "${secret?.name}"` : ''} with id "${id}".`);
  }
}
