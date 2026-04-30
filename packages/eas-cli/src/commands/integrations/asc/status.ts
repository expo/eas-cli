import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  buildInvalidJsonOutput,
  buildJsonOutput,
  formatAscAppLinkStatus,
  isAscAuthenticationError,
} from '../../../integrations/asc/utils';
import { AscAppLinkQuery } from '../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsAscStatus extends EasCommand {
  static override description =
    'show the App Store Connect app link status for the current project';

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsAscStatus);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsAscStatus, {
      nonInteractive,
    });

    const metadata = await this.fetchStatusAsync(graphqlClient, projectId);
    if (!metadata) {
      if (json) {
        printJsonOnlyOutput(buildInvalidJsonOutput('status', projectId));
      } else {
        Log.addNewLineIfNone();
        Log.warn(
          'The App Store Connect API key linked to this project has been revoked or is no longer valid.'
        );
      }
      return;
    }

    if (json) {
      printJsonOnlyOutput(buildJsonOutput('status', metadata));
    } else {
      Log.addNewLineIfNone();
      Log.log(formatAscAppLinkStatus(metadata));
    }
  }

  private async fetchStatusAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string
  ): Promise<Awaited<ReturnType<typeof AscAppLinkQuery.getAppMetadataAsync>> | null> {
    const spinner = ora('Fetching App Store Connect app link status').start();
    try {
      const metadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
      spinner.succeed('Fetched App Store Connect app link status');
      return metadata;
    } catch (err) {
      if (isAscAuthenticationError(err)) {
        spinner.fail('App Store Connect connection is invalid');
        return null;
      }
      spinner.fail('Failed to fetch App Store Connect app link status');
      throw err;
    }
  }
}
