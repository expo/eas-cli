import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import chalk from 'chalk';

import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { getActorDisplayName } from '../../user/User';
import { ensureLoggedInAsync } from '../../user/actions';

export enum EnvironmentSecretTargetLocation {
  ACCOUNT = 'account',
  PROJECT = 'project',
}
export default class EnvironmentSecretCreate extends Command {
  static hidden = true;
  static description = 'Create an environment secret on the current project or owner account.';

  static args = [
    {
      name: 'target',
      required: false,
      description: 'Target location for the secret',
      options: [EnvironmentSecretTargetLocation.ACCOUNT, EnvironmentSecretTargetLocation.PROJECT],
    },
    {
      name: 'name',
      required: false,
      description: 'Name of the secret',
    },
    {
      name: 'value',
      required: false,
      description: 'Value of the secret',
    },
  ];

  async run() {
    const actor = await ensureLoggedInAsync();
    let {
      args: { name, value: secretValue, target },
    } = this.parse(EnvironmentSecretCreate);

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);

    const { slug } = exp;
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    if (!target) {
      const validationMessage = 'Secret target may not be empty.';

      ({ target } = await promptAsync({
        type: 'select',
        name: 'target',
        message: 'Where should this secret be used:',
        choices: [
          { title: 'Account-wide', value: EnvironmentSecretTargetLocation.ACCOUNT },
          { title: 'Project-specific', value: EnvironmentSecretTargetLocation.PROJECT },
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

          if (value.match(/^\w+$/)) {
            return 'Names may contain only letters, numbers, and underscores.';
          }

          return true;
        },
      }));
    }

    if (!secretValue) {
      const validationMessage = 'Secret value may not be empty.';

      ({ secretValue } = await promptAsync({
        type: 'text',
        name: 'secretValue',
        message: 'Secret value:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (target === EnvironmentSecretTargetLocation.PROJECT) {
      const secret = await EnvironmentSecretMutation.createForApp(
        { name, value: secretValue },
        projectId
      );
      if (!secret) {
        throw new Error(
          `Could not create secret with name ${name} on project with id ${projectId}`
        );
      }

      Log.withTick(
        `️Created a new secret ${chalk.bold(name)} on project ${chalk.bold(
          `@${accountName}/${slug}`
        )}.`
      );
    } else if (target === EnvironmentSecretTargetLocation.ACCOUNT) {
      const ownerAccount = findAccountByName(actor.accounts, accountName);
      if (!ownerAccount) {
        Log.warn(
          `Your account (${getActorDisplayName(actor)}) doesn't have access to the ${chalk.bold(
            accountName
          )} account`
        );
        return;
      }

      const secret = await EnvironmentSecretMutation.createForAccount(
        { name, value: secretValue },
        ownerAccount.id
      );

      if (!secret) {
        throw new Error(
          `Could not create secret with name ${name} on account with id ${ownerAccount.id}`
        );
      }

      Log.withTick(
        `️Created a new secret ${chalk.bold(name)} on account ${chalk.bold(ownerAccount.name)}.`
      );
    }
  }
}
