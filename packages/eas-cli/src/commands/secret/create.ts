import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
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
import {
  getDisplayNameForProjectIdAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';

export default class EnvironmentSecretCreate extends EasCommand {
  static override description =
    'create an environment secret on the current project or owner account';
  static override hidden = true;

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
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    Log.warn('This command is deprecated. Use eas env:create instead.');
    Log.newLine();

    let {
      flags: {
        name,
        value: secretValue,
        scope,
        force,
        type: secretType,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(EnvironmentSecretCreate);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentSecretCreate, {
      nonInteractive,
    });

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    const ownerAccount = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    if (!scope) {
      const validationMessage = 'Secret scope may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

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
      const validationMessage = 'Secret name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: `Secret name:`,
        validate: value => {
          if (!value) {
            return validationMessage;
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
        throw new Error(validationMessage);
      }
    }

    if (!secretType) {
      if (nonInteractive) {
        throw new Error('Secret type may not be empty in non-interactive mode');
      }

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
      const validationMessage = 'Secret value may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

      ({ secretValue } = await promptAsync({
        type: 'text',
        name: 'secretValue',
        message: secretType === SecretType.STRING ? 'Secret value:' : 'Local file path:',
        // eslint-disable-next-line async-protect/async-suffix
        validate: async secretValue => {
          if (!secretValue) {
            return validationMessage;
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
      secretValue = await fs.readFile(secretFilePath, 'base64');
    }

    if (scope === EnvironmentSecretScope.PROJECT) {
      if (force) {
        const { appSecrets: existingSecrets } = await EnvironmentSecretsQuery.byAppIdAsync(
          graphqlClient,
          projectId
        );
        const existingSecret = existingSecrets.find(secret => secret.name === name);

        if (existingSecret) {
          await EnvironmentSecretMutation.deleteAsync(graphqlClient, existingSecret.id);
          Log.withTick(
            `Deleting existing secret ${chalk.bold(name)} on project ${chalk.bold(
              projectDisplayName
            )}.`
          );
        }
      }

      const secret = await EnvironmentSecretMutation.createForAppAsync(
        graphqlClient,
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
          `Created a new secret ${chalk.bold(name)} with value ${chalk.bold(
            secretValue
          )} on project ${chalk.bold(projectDisplayName)}.`
        );
      } else {
        Log.withTick(
          `Created a new secret ${chalk.bold(name)} from file ${chalk.bold(
            secretFilePath
          )} on project ${chalk.bold(projectDisplayName)}.`
        );
      }
    } else if (scope === EnvironmentSecretScope.ACCOUNT) {
      if (force) {
        const { accountSecrets: existingSecrets } = await EnvironmentSecretsQuery.byAppIdAsync(
          graphqlClient,
          projectId
        );
        const existingSecret = existingSecrets.find(secret => secret.name === name);

        if (existingSecret) {
          await EnvironmentSecretMutation.deleteAsync(graphqlClient, existingSecret.id);

          Log.withTick(
            `Deleting existing secret ${chalk.bold(name)} on account ${chalk.bold(
              ownerAccount.name
            )}.`
          );
        }
      }

      const secret = await EnvironmentSecretMutation.createForAccountAsync(
        graphqlClient,
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
          `Created a new secret ${chalk.bold(name)} with value ${chalk.bold(
            secretValue
          )} on account ${chalk.bold(ownerAccount.name)}.`
        );
      } else {
        Log.withTick(
          `Created a new secret ${chalk.bold(name)} from file ${chalk.bold(
            secretFilePath
          )} on account ${chalk.bold(ownerAccount.name)}.`
        );
      }
    }
  }
}
