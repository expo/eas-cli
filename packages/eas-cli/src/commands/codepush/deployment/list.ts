/**
 * $ appcenter codepush deployment list --help

List the deployments associated with an app

Usage: appcenter codepush deployment list [-s|--skipFetchingDeploymentMetrics] [-k|--displayKeys]
         [-a|--app <arg>]

Options:
    -s|--skipFetchingDeploymentMetrics             Specifies whether to fetch deployment metrics
    -k|--displayKeys                               Specifies whether to display the deployment keys
    -a|--app <arg>                                 Specify app in the <ownerName>/<appName> format

Common Options (works on all commands):
       --disable-telemetry             Disable telemetry for this command
    -v|--version                       Display appcenter version
       --quiet                         Auto-confirm any prompts without waiting for input
    -h|--help                          Display help for current command
       --env <arg>                     Environment when using API token
       --token <arg>                   API token
       --output <arg>                  Output format: json
       --debug                         Display extra output for debugging
 */

import { CHANNELS_LIMIT, listAndRenderChannelsOnAppAsync } from '../../../channel/queries';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../../commandUtils/pagination';
import { enableJsonOutput } from '../../../utils/json';

export default class CodepushDeploymentList extends EasCommand {
  static override hidden = true;
  static override description = 'list deployments';

  static override flags = {
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: CHANNELS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(CodepushDeploymentList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag, 'non-interactive': nonInteractive } = flags;
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushDeploymentList, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    await listAndRenderChannelsOnAppAsync(graphqlClient, {
      projectId,
      paginatedQueryOptions,
    });
  }
}
