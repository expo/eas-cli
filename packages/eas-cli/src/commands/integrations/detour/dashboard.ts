import openBrowserAsync from 'better-opn';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getAppRedirectUrl } from '../../../integrations/detour/api';
import { readConnection } from '../../../integrations/detour/linking';
import Log, { link } from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsDetourDashboard extends EasCommand {
  static override description = "open this project's Detour app in the dashboard";

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsDetourDashboard);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { exp },
    } = await this.getContextAsync(IntegrationsDetourDashboard, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const connection = readConnection(exp);
    if (!connection) {
      throw new Error(
        'This project is not connected to Detour. Run eas integrations:detour:connect first.'
      );
    }

    const url = getAppRedirectUrl(connection.appId);
    if (jsonFlag) {
      printJsonOnlyOutput({ appId: connection.appId, url });
      return;
    }

    // No browser to open on a CI machine, so the URL is the useful output.
    if (nonInteractive) {
      Log.log(url);
      return;
    }

    const opened = await openBrowserAsync(url).catch(() => false);
    Log.log(opened ? `Opened ${link(url)}` : link(url));
  }
}
