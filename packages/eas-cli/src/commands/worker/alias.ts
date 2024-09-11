import { Flags } from '@oclif/core';

import Log from '../../log';
import EasCommand from '../../commandUtils/EasCommand';
import { ora } from '../../ora';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { assignWorkerDeploymentAliasAsync } from '../../worker/deployment';
import chalk from 'chalk';

export default class WorkerAlias extends EasCommand {
  static override description = 'Inspect or modify deployment alias';
  static override aliases = ['deploy:alias'];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    id: Flags.string({
      description: 'Expo deployment ID',
      required: true,
    }),
    alias: Flags.string({
      description: 'Deployment alias',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  override async runAsync() {
    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const { flags } = await this.parse(WorkerAlias);

    // If `--id` is not defined, fetch the deployment IDs as list
    //   - If non-interactive mode is enabled, abort after this
    //   - If `--json` is provided, return the data as json
    // If `--alias` is not defined, fetch the alias of the deployment ID
    //   - If `--alias` is defined, update the alias of the deployment ID

    if (!flags.id) throw new Error('Please provide a deployment ID');
    if (!flags.alias) throw new Error('Please provide an alias');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerAlias, {
      nonInteractive: true,
    });

    const { projectId } = await getDynamicPrivateProjectConfigAsync();
    const progress = ora('Assigning alias to worker deployment').start();

    const workerAlias = await assignWorkerDeploymentAliasAsync({
      graphqlClient,
      appId: projectId,
      deploymentId: flags.id,
      aliasName: flags.alias,
    });

    progress.succeed(chalk`Alias {bold ${workerAlias.aliasName}} assigned to deployment {bold ${flags.id}}`);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your deployment is now available on: ${workerAlias.url}`);
  }
}
