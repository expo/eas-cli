import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';

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

export default class EnvironmentSecretList extends Command {
  static description = 'Lists environment secrets available for your current app';
  static usage = 'secrets:list';

  async run(): Promise<void> {
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

    if (!projectDir) {
      throw new Error("Please run this command inside your project's directory");
    }

    const secrets = await EnvironmentSecretsQuery.allAsync(projectAccountName, projectFullName);

    const table = new Table({
      head: ['Name', 'Scope', 'ID', 'Updated at'],
      wordWrap: true,
    });

    for (const secret of secrets) {
      const { name, createdAt: updatedAt, scope, id } = secret;
      table.push([name, scope, id, dateFormat(updatedAt, 'mmm dd HH:MM:ss')]);
    }

    Log.log(chalk`{bold Secrets for this account and project:}`);
    Log.log(table.toString());
  }
}
