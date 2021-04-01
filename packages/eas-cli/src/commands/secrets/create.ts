import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
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

export enum EnvironmentSecretScope {
  ACCOUNT = 'account',
  PROJECT = 'project',
}
export default class EnvironmentSecretCreate extends Command {
  static description = 'Create an environment secret on the current project or owner account.';

  static flags = {
    scope: flags.enum({
      description: 'Scope for the secret',
      options: [EnvironmentSecretScope.ACCOUNT, EnvironmentSecretScope.PROJECT],
      default: EnvironmentSecretScope.PROJECT,
    }),
    name: flags.string({
      description: 'Name of the secret',
    }),
    value: flags.string({
      description: 'Value of the secret',
    }),
  };

  async run() {
    const actor = await ensureLoggedInAsync();
    let {
      flags: { name, value: secretValue, scope },
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

      if (!name) throw new Error('Secret name may not be empty.');
    }

    if (!secretValue) {
      const validationMessage = 'Secret value may not be empty.';

      ({ secretValue } = await promptAsync({
        type: 'text',
        name: 'secretValue',
        message: 'Secret value:',
        validate: value => (value ? true : validationMessage),
      }));

      if (!secretValue) throw new Error(validationMessage);
    }

    if (scope === EnvironmentSecretScope.PROJECT) {
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
