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

  static override examples = [
    '$ eas status \t # Show a concise project snapshot',
    '$ eas status --json \t # Output a machine-readable snapshot for agents and automation',
    '$ eas status --json --limit 10 \t # Include more activity from each section',
  ];

  static override flags = {
    limit: getLimitFlagWithCustomValues({
      defaultTo: PROJECT_STATUS_DEFAULT_LIMIT,
      limit: 25,
      description: `The number of items to show in each section. Defaults to ${PROJECT_STATUS_DEFAULT_LIMIT} and is capped at 25.`,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ProjectStatus);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectStatus, { nonInteractive });

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
