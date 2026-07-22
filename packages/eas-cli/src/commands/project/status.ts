import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import {
  PROJECT_STATUS_DEFAULT_LIMIT,
  getProjectStatusAsync,
  printProjectStatusAsText,
} from '../../project/projectStatus';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ProjectStatus extends EasCommand {
  static override description =
    'show a snapshot of the project: recent builds, dev builds, workflow runs, submissions, and updates';

  static override aliases = ['status'];

  static override flags = {
    limit: getLimitFlagWithCustomValues({ defaultTo: PROJECT_STATUS_DEFAULT_LIMIT, limit: 25 }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ProjectStatus);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectStatus, { nonInteractive });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const status = await getProjectStatusAsync(graphqlClient, {
      projectId,
      limit: flags.limit ?? PROJECT_STATUS_DEFAULT_LIMIT,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(status);
      return;
    }

    printProjectStatusAsText(status);
  }
}
