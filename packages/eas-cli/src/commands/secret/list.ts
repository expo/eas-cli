import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';

import EasCommand from '../../commandUtils/EasCommand';
import { EnvironmentSecretsQuery } from '../../graphql/queries/EnvironmentSecretsQuery';
import { EnvironmentSecretTypeToSecretType } from '../../graphql/types/EnvironmentSecret';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';

export default class EnvironmentSecretList extends EasCommand {
  static override description = 'list environment secrets available for your current app';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const projectAccountName = await getProjectAccountNameAsync(exp);

    if (!projectDir) {
      throw new Error("Run this command inside your project's directory");
    }

    const secrets = await EnvironmentSecretsQuery.allAsync(projectAccountName, projectId);

    const table = new Table({
      head: ['Name', 'Type', 'Scope', 'ID', 'Updated at'],
      wordWrap: true,
    });

    for (const secret of secrets) {
      const { name, createdAt: updatedAt, scope, id, type } = secret;
      table.push([
        name,
        EnvironmentSecretTypeToSecretType[type],
        scope,
        id,
        dateFormat(updatedAt, 'mmm dd HH:MM:ss'),
      ]);
    }

    Log.log(chalk`{bold Secrets for this account and project:}`);
    Log.log(table.toString());
  }
}
