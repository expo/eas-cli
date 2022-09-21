import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';

import EasCommand, { EASCommandProjectIdContext } from '../../commandUtils/EasCommand';
import { EnvironmentSecretsQuery } from '../../graphql/queries/EnvironmentSecretsQuery';
import { EnvironmentSecretTypeToSecretType } from '../../graphql/types/EnvironmentSecret';
import Log from '../../log';

export default class EnvironmentSecretList extends EasCommand {
  static override description = 'list environment secrets available for your current app';

  static override contextDefinition = {
    ...EASCommandProjectIdContext,
  };

  async runAsync(): Promise<void> {
    const { projectId } = await this.getContextAsync(EnvironmentSecretList, {
      nonInteractive: true,
    });

    const secrets = await EnvironmentSecretsQuery.allAsync(projectId);

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
