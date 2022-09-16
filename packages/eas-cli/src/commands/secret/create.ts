import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import {
  EnvironmentSecretScope,
  EnvironmentSecretsQuery,
} from '../../graphql/queries/EnvironmentSecretsQuery';
import {
  SecretType,
  SecretTypeToEnvironmentSecretType,
} from '../../graphql/types/EnvironmentSecret';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { getActorDisplayName } from '../../user/User';
import { ensureLoggedInAsync } from '../../user/actions';

export default class EnvironmentSecretCreate extends EasCommand {
  static override description =
    'create an environment secret on the current project or owner account';

  static override flags = {
    scope: Flags.enum({
      description: 'Scope for the secret',
      options: [EnvironmentSecretScope.ACCOUNT, EnvironmentSecretScope.PROJECT],
      default: EnvironmentSecretScope.PROJECT,
    }),
    name: Flags.string({
      description: 'Name of the secret',
    }),
    value: Flags.string({
      description: 'Text value or path to a file to store in the secret',
    }),
    type: Flags.enum({
      description: 'The type of secret',
      options: [SecretType.STRING, SecretType.FILE],
    }),
    force: Flags.boolean({
      description: 'Delete and recreate existing secrets',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const actor = await ensureLoggedInAsync();
    let {
      flags: { name, value: secretValue, scope, force, type: secretType },
    } = await this.parse(EnvironmentSecretCreate);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const accountName = await getProjectAccountNameAsync(exp);

    const { slug } = exp;
    const projectId = await getProjectIdAsync(exp);

    if (!scope) {
      const validationMessage = 'Secret scope may not be empty.';

      ({ scope } = await promptAsync({
        type: 'select',
        name: 'scope',
        message: 'Where should this secret be used:',
        choices: [
          { title: 'Account-wide', value: EnvironmentSecretScope.ACCOUNT },
          { title: 'Project-specific', value: EnvironmentSecretScope.PROJECT },
        ],
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!name) {
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: `Secret name:`,
        validate: value => {
          if (!value) {
            return 'Secret name may not be empty.';
          }

          // this validation regex here is just to shorten the feedback loop
          // the source of truth is in www's EnvironmentSecretValidator class
          if (!value.match(/^\w+$/)) {
            return 'Names may contain only letters, numbers, and underscores.';
          }

          return true;
        },
      }));

      if (!name) {
        throw new Error('Secret name may not be empty.');
      }
    }

    if (!secretType) {
      secretType = await selectAsync('Select secret type', [
        {
          title: 'string',
          value: SecretType.STRING,
        },
        {
          title: 'file',
          value: SecretType.FILE,
        },
      ]);
    }

    if (!secretValue) {
      ({ secretValue } = await promptAsync({
        type: 'text',
        name: 'secretValue',
        message: secretType === SecretType.STRING ? 'Secret value:' : 'Local file path:',
        // eslint-disable-next-line async-protect/async-suffix
        validate: async secretValue => {
          if (!secretValue) {
            return 'Secret value may not be empty.';
          }
          if (secretType === SecretType.FILE) {
            const secretFilePath = path.resolve(secretValue);
            if (!(await fs.pathExists(secretFilePath))) {
              return `File "${secretValue}" does not exist.`;
            }
          }
          return true;
        },
      }));
    }

    assert(secretValue);

    let secretFilePath: string | undefined;
    if (secretType === SecretType.FILE) {
      secretFilePath = path.resolve(secretValue);
      if (!(await fs.pathExists(secretFilePath))) {
        throw new Error(`File "${secretValue}" does not exist`);
      }
    }

    if (scope === EnvironmentSecretScope.PROJECT) {
      if (force) {
        const existingSecrets = await EnvironmentSecretsQuery.byAppIdAsync(projectId);
        const existingSecret = existingSecrets.find(secret => secret.name === name);

        if (existingSecret) {
          await EnvironmentSecretMutation.deleteAsync(existingSecret.id);
          Log.withTick(
            `Deleting existing secret ${chalk.bold(name)} on project ${chalk.bold(
              `@${accountName}/${slug}`
            )}.`
          );
        }
      }

      const secret = await EnvironmentSecretMutation.createForAppAsync(
        { name, value: secretValue, type: SecretTypeToEnvironmentSecretType[secretType] },
        projectId
      );
      if (!secret) {
        throw new Error(
          `Could not create secret with name ${name} on project with id ${projectId}`
        );
      }

      if (secretType === SecretType.STRING) {
        Log.withTick(
          `️Created a new secret ${chalk.bold(name)} with value ${chalk.bold(
            secretValue
          )} on project ${chalk.bold(`@${accountName}/${slug}`)}.`
        );
      } else {
        Log.withTick(
          `️Created a new secret ${chalk.bold(name)} from file ${chalk.bold(
            secretFilePath
          )} on project ${chalk.bold(`@${accountName}/${slug}`)}.`
        );
      }
    } else if (scope === EnvironmentSecretScope.ACCOUNT) {
      const ownerAccount = findAccountByName(actor.accounts, accountName);

      if (!ownerAccount) {
        Log.warn(
          `Your account (${getActorDisplayName(actor)}) doesn't have access to the ${chalk.bold(
            accountName
          )} account`
        );
        return;
      }

      if (force) {
        const existingSecrets = await EnvironmentSecretsQuery.byAccountNameAsync(ownerAccount.name);
        const existingSecret = existingSecrets.find(secret => secret.name === name);

        if (existingSecret) {
          await EnvironmentSecretMutation.deleteAsync(existingSecret.id);

          Log.withTick(
            `Deleting existing secret ${chalk.bold(name)} on account ${chalk.bold(
              ownerAccount.name
            )}.`
          );
        }
      }

      const secret = await EnvironmentSecretMutation.createForAccountAsync(
        { name, value: secretValue, type: SecretTypeToEnvironmentSecretType[secretType] },
        ownerAccount.id
      );

      if (!secret) {
        throw new Error(
          `Could not create secret with name ${name} on account with id ${ownerAccount.id}`
        );
      }

      if (secretType === SecretType.STRING) {
        Log.withTick(
          `️Created a new secret ${chalk.bold(name)} with value ${chalk.bold(
            secretValue
          )} on account ${chalk.bold(ownerAccount.name)}.`
        );
      } else {
        Log.withTick(
          `️Created a new secret ${chalk.bold(name)} from file ${chalk.bold(
            secretFilePath
          )} on account ${chalk.bold(ownerAccount.name)}.`
        );
      }
    }
  }
}
