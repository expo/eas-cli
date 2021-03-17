import { Command } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';

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
import { EnvironmentSecretTargetLocation } from './create';

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

    const secrets = [
      ...appSecrets.map(s => ({ ...s, target: EnvironmentSecretTargetLocation.PROJECT })),
      ...accountSecrets.map(s => ({ ...s, target: EnvironmentSecretTargetLocation.ACCOUNT })),
    ] as (EnvironmentSecretFragment & { target: EnvironmentSecretTargetLocation })[];

    const table = new Table({
      head: ['Name', 'Target', 'Updated at', 'ID'],
      wordWrap: true,
    });

    for (const secret of secrets) {
      const { name, createdAt: updatedAt, target, id } = secret;
      table.push([name, target, dateFormat(updatedAt, 'mmm dd HH:MM:ss'), id]);
    }

    Log.log(chalk`{bold Secrets for this account and project:}`);
    Log.log(table.toString());
  }
}
