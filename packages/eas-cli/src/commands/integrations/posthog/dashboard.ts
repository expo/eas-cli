import openBrowserAsync from 'better-opn';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getPostHogProjectDashboardUrl, logNoPostHogProject } from '../../../commandUtils/posthog';
import { PostHogQuery } from '../../../graphql/queries/PostHogQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsPostHogDashboard extends EasCommand {
  static override description = 'open the PostHog dashboard for the linked PostHog project';

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsPostHogDashboard);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsPostHogDashboard, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const posthogProject = await PostHogQuery.getPostHogProjectByAppIdAsync(
      graphqlClient,
      projectId
    );

    if (!posthogProject) {
      if (jsonFlag) {
        printJsonOnlyOutput({ dashboardUrl: null });
      } else {
        logNoPostHogProject(exp.slug);
      }
      return;
    }

    const dashboardUrl = getPostHogProjectDashboardUrl(posthogProject);

    if (jsonFlag) {
      printJsonOnlyOutput({ dashboardUrl });
      return;
    }

    if (nonInteractive) {
      Log.log(dashboardUrl);
      return;
    }

    const failedMessage = `Unable to open a web browser. PostHog dashboard is available at: ${dashboardUrl}`;
    const spinner = ora(`Opening ${dashboardUrl}`).start();
    try {
      const opened = await openBrowserAsync(dashboardUrl);
      if (opened) {
        spinner.succeed(`Opened ${dashboardUrl}`);
      } else {
        spinner.fail(failedMessage);
      }
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
