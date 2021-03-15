import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import chalk from 'chalk';

import { AccountResolver } from '../../devices/manager';
import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

export default class EnvironmentSecretCreate extends Command {
  static hidden = true;
  static description = 'Create an environment secret for on the current project or owner account.';

  static args = [
    {
      name: 'target',
      required: false,
      description: 'Target location for the secret',
      options: ['account', 'project'],
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
    const user = await ensureLoggedInAsync();
    let {
      args: { name, value: secretValue, target },
    } = this.parse(EnvironmentSecretCreate);

    if (!target) {
      const validationMessage = 'Secret target may not be empty.';

      ({ target } = await promptAsync({
        type: 'select',
        name: 'target',
        message: 'Where should this secret be used:',
        choices: [
          { title: 'Account-wide', value: 'account' },
          { title: 'Project-specific', value: 'project' },
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

    const projectDir = await findProjectRootAsync(process.cwd());

    let secret;

    if (target === 'project') {
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

      secret = await EnvironmentSecretMutation.createForApp(
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
    }

    if (target === 'account') {
      const resolver = new AccountResolver(projectDir, user);
      const ownerAccount = await resolver.resolveAccountAsync();

      secret = await EnvironmentSecretMutation.createForAccount(
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
