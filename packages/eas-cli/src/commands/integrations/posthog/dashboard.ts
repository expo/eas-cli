import { Flags } from '@oclif/core';
import openBrowserAsync from 'better-opn';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getPostHogProjectDashboardUrl, logNoPostHogProject } from '../../../commandUtils/posthog';
import { PostHogDeepLinkPurpose } from '../../../graphql/generated';
import { PostHogMutation } from '../../../graphql/mutations/PostHogMutation';
import { PostHogQuery } from '../../../graphql/queries/PostHogQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsPostHogDashboard extends EasCommand {
  static override description = 'open the PostHog dashboard for the linked PostHog project';

  static override flags = {
    'show-link': Flags.boolean({
      default: false,
      description:
        'Print the signed-in dashboard URL in addition to opening it. The URL contains a single-use login token.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsPostHogDashboard);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const showLink = flags['show-link'];
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

    const staticDashboardUrl = getPostHogProjectDashboardUrl(posthogProject);

    // Signed-in deep links are single-use and expire in 10 minutes, so only the interactive
    // browser-open benefits from one. JSON/non-interactive consumers may store the URL, so give
    // them the stable (login-required) dashboard URL instead.
    if (jsonFlag) {
      printJsonOnlyOutput({ dashboardUrl: staticDashboardUrl });
      return;
    }

    if (nonInteractive) {
      Log.log(staticDashboardUrl);
      return;
    }

    let dashboardUrl: string;
    try {
      dashboardUrl = await PostHogMutation.createPostHogDeepLinkAsync(graphqlClient, {
        posthogOrganizationConnectionId: posthogProject.posthogOrganizationConnection.id,
        appId: projectId,
        purpose: PostHogDeepLinkPurpose.Dashboard,
      });
    } catch (error) {
      Log.debug(`Failed to mint a PostHog deep link; opening the static dashboard URL: ${error}`);
      dashboardUrl = staticDashboardUrl;
    }

    const openLabel = showLink ? dashboardUrl : 'your PostHog dashboard';
    const failedMessage = `Unable to open a web browser. PostHog dashboard is available at: ${
      showLink ? dashboardUrl : staticDashboardUrl
    }`;
    const spinner = ora(`Opening ${openLabel}`).start();
    try {
      const opened = await openBrowserAsync(dashboardUrl);
      if (opened) {
        spinner.succeed(`Opened ${openLabel}`);
      } else {
        spinner.fail(failedMessage);
      }
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
