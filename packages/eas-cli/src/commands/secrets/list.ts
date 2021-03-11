import { Command } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';

import { EnvironmentSecretFragment } from '../../graphql/generated';
import { EnvironmentSecretsQuery } from '../../graphql/queries/EnvironmentSecretsQuery';
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
import { ensureLoggedInAsync } from '../../user/actions';

export default class EnvironmentSecretsList extends Command {
  static description = 'Lists environment secrets available for your current app';
  static usage = 'secrets:list';

  async run(): Promise<void> {
    await ensureLoggedInAsync();

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const projectId = await getProjectIdAsync(projectDir);
    const projectFullName = await getProjectFullNameAsync(projectDir);
    const projectAccountName = await getProjectAccountNameAsync(projectDir);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    if (!projectDir) {
      throw new Error("Please run this command inside your project's directory");
    }

    const [accountSecrets, appSecrets] = await Promise.all([
      EnvironmentSecretsQuery.byAcccountNameAsync(projectAccountName),
      EnvironmentSecretsQuery.byAppFullNameAsync(projectFullName),
    ]);

    const appSecretNames = new Set(appSecrets.map(appSecret => appSecret.name));
    const filteredAccountSecrets = accountSecrets.filter(
      accountSecret => !appSecretNames.has(accountSecret.name)
    );

    const secrets = [
      ...appSecrets.map(s => ({ ...s, type: 'app-specific' })),
      ...filteredAccountSecrets.map(s => ({ ...s, type: 'account-wide' })),
    ] as (EnvironmentSecretFragment & { type: 'app-specific' | 'account-wide' })[];

    const table = new Table({
      head: ['name', 'type', 'updated-at'],
      wordWrap: true,
    });

    for (const secret of secrets) {
      const { name, createdAt: updatedAt, type } = secret;
      table.push([name, type, updatedAt]);
    }

    Log.log(chalk`{bold Secrets for this app:}`);
    Log.log(table.toString());
  }
}
