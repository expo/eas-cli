import { Flags } from '@oclif/core';

import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { maybeSetProjectIconFromAppConfigAsync } from '../../project/projectIcon';
import {
  ProjectInitResult,
  ensureOwnerSlugConsistencyAsync,
  initializeWithExplicitIDAsync,
  initializeWithoutExplicitIDAsync,
} from '../../project/projectInitialization';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ProjectInit extends EasCommand {
  static override description = 'create or link an EAS project';
  static override aliases = ['init'];

  static override examples = [
    '$ eas init  \t # Create or link a project interactively',
    '$ eas init --id <project-id>  \t # Link to the project with the given ID',
    '$ eas init --account my-account --non-interactive  \t # Create or link @my-account/<slug> without prompts',
    '$ eas init --account my-account --json --non-interactive  \t # Same, and print the result as JSON to stdout',
  ];

  static override flags = {
    id: Flags.string({
      description: 'ID of the EAS project to link',
    }),
    account: Flags.string({
      description: 'Name of the account that will own the project',
      exclusive: ['id'],
    }),
    force: Flags.boolean({
      description:
        'Whether to create a new project/link an existing project without additional prompts or overwrite any existing project ID when running with --id flag',
    }),
    icon: Flags.boolean({
      description:
        'Set the icon shown on the EAS dashboard from the app config, when the project does not have one yet',
      default: true,
      allowNo: true,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ProjectInit);
    const { id: idArgument, account: accountArgument, force } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }
    const {
      loggedIn: { actor, graphqlClient },
      projectDir,
    } = await this.getContextAsync(ProjectInit, { nonInteractive });

    let result: ProjectInitResult;
    if (idArgument) {
      const status = await initializeWithExplicitIDAsync(idArgument, projectDir, {
        force,
        nonInteractive,
      });
      result = { projectId: idArgument, status };
    } else {
      result = await initializeWithoutExplicitIDAsync(graphqlClient, actor, projectDir, {
        force,
        nonInteractive,
        accountName: accountArgument,
      });
    }

    const { owner, slug } = await ensureOwnerSlugConsistencyAsync(
      graphqlClient,
      result.projectId,
      projectDir,
      {
        force,
        nonInteractive,
      }
    );

    const iconResult = flags.icon
      ? await maybeSetProjectIconFromAppConfigAsync(graphqlClient, {
          projectId: result.projectId,
          projectDir,
        })
      : null;

    if (jsonFlag) {
      printJsonOnlyOutput({
        status: result.status,
        projectId: result.projectId,
        owner,
        slug,
        dashboardUrl: getProjectDashboardUrl(owner, slug),
        ...(iconResult?.status === 'set' ? { icon: { source: iconResult.icon.field } } : {}),
      });
    }
  }
}
