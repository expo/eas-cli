import openBrowserAsync from 'better-opn';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  getSupabaseProjectDashboardUrl,
  logNoSupabaseProject,
} from '../../../commandUtils/supabase';
import { SupabaseQuery } from '../../../graphql/queries/SupabaseQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsSupabaseDashboard extends EasCommand {
  static override description =
    "open this app's primary Supabase project in the dashboard (or print the URL with --non-interactive)";

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --non-interactive',
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsSupabaseDashboard);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSupabaseDashboard, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const project = await SupabaseQuery.getSupabaseProjectByAppIdAsync(graphqlClient, projectId);
    if (!project) {
      if (jsonFlag) {
        printJsonOnlyOutput({ dashboardUrl: null });
      } else {
        logNoSupabaseProject(exp.slug);
      }
      return;
    }

    const dashboardUrl = getSupabaseProjectDashboardUrl(project);
    if (jsonFlag) {
      printJsonOnlyOutput({ dashboardUrl });
      return;
    }
    if (nonInteractive) {
      Log.log(dashboardUrl);
      return;
    }

    const spinner = ora('Opening your Supabase dashboard').start();
    try {
      const opened = await openBrowserAsync(dashboardUrl);
      if (opened) {
        spinner.succeed('Opened your Supabase dashboard');
      } else {
        spinner.fail(`Unable to open a web browser. Supabase dashboard: ${dashboardUrl}`);
      }
    } catch (error) {
      spinner.fail(`Unable to open a web browser. Supabase dashboard: ${dashboardUrl}`);
      throw error;
    }
  }
}
