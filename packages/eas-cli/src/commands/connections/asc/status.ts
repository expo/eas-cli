import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { buildJsonOutput, formatAscAppLinkStatus } from '../../../connections/asc/utils';
import { AscAppLinkQuery } from '../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class ConnectionsAscStatus extends EasCommand {
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
    const { flags } = await this.parse(ConnectionsAscStatus);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ConnectionsAscStatus, {
      nonInteractive,
    });

    const spinner = ora('Fetching App Store Connect app link status').start();
    try {
      const metadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
      spinner.succeed('Fetched App Store Connect app link status');

      if (json) {
        printJsonOnlyOutput(buildJsonOutput('status', metadata));
      } else {
        Log.addNewLineIfNone();
        Log.log(formatAscAppLinkStatus(metadata));
      }
    } catch (err) {
      spinner.fail('Failed to fetch App Store Connect app link status');
      throw err;
    }
  }
}
