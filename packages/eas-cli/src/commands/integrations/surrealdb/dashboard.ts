import openBrowserAsync from 'better-opn';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { loadProjectScopedEnvVarsAsync } from '../../../environments/variables';
import { SURREAL_STUDIO_URL } from '../../../integrations/surrealdb/endpoint';
import { EAS_SURREAL_ENDPOINT_ENV_VAR_NAME } from '../../../integrations/surrealdb/env';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsSurrealdbDashboard extends EasCommand {
  static override description =
    "open SurrealDB Studio and list this app's SurrealDB endpoints (or print the URL with --non-interactive)";

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
    const { flags } = await this.parse(IntegrationsSurrealdbDashboard);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSurrealdbDashboard, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    // The EAS variables are the connection: there is no other record of it to read.
    const endpoints = (
      await loadProjectScopedEnvVarsAsync(
        graphqlClient,
        projectId,
        EAS_SURREAL_ENDPOINT_ENV_VAR_NAME
      )
    )
      .filter(variable => !!variable.value)
      .map(variable => ({
        endpoint: variable.value as string,
        environments: variable.environments ?? [],
      }));

    if (endpoints.length === 0) {
      if (jsonFlag) {
        printJsonOnlyOutput({ dashboardUrl: null, endpoints: [] });
      } else {
        Log.warn(
          `No SurrealDB instance is connected to ${chalk.bold(exp.slug)}. Run ${chalk.bold('eas integrations:surrealdb:connect')} first.`
        );
      }
      return;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ dashboardUrl: SURREAL_STUDIO_URL, endpoints });
      return;
    }

    for (const { endpoint, environments } of endpoints) {
      Log.log(`${chalk.bold(environments.join(', ') || 'no environment')}: ${endpoint}`);
    }
    if (nonInteractive) {
      Log.log(SURREAL_STUDIO_URL);
      return;
    }

    const spinner = ora('Opening SurrealDB Studio').start();
    try {
      const opened = await openBrowserAsync(SURREAL_STUDIO_URL);
      if (opened) {
        spinner.succeed(
          'Opened SurrealDB Studio. Connect to the endpoint above to browse your data.'
        );
      } else {
        spinner.fail(`Unable to open a web browser. SurrealDB Studio: ${SURREAL_STUDIO_URL}`);
      }
    } catch (error) {
      spinner.fail(`Unable to open a web browser. SurrealDB Studio: ${SURREAL_STUDIO_URL}`);
      throw error;
    }
  }
}
