import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { printGitHubRepository } from '../../../commandUtils/github';
import { GitHubRepositoryQuery } from '../../../graphql/queries/GitHubRepositoryQuery';
import { enableJsonOutput } from '../../../utils/json';

export default class IntegrationsGitHubStatus extends EasCommand {
  static override description = 'show the GitHub repository linked to the current EAS project';

  static override flags = { ...EasNonInteractiveAndJsonFlags };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsGitHubStatus);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsGitHubStatus, { nonInteractive });
    const app = await GitHubRepositoryQuery.getAppAsync(graphqlClient, projectId);
    printGitHubRepository(app, { json });
  }
}
