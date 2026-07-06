import { Flags } from '@oclif/core';

import { getDeviceRunSessionUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  deviceRunSessionTypeToFlagValue,
  formatRemoteSessionInstructions,
} from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorGet extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] get info about a remote simulator session on EAS by its simulator session ID';

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorGet);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorGet, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const flagId = flags.id || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!flagId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const fetchSpinner = ora(`Fetching simulator session ${flagId}`).start();
    let session;
    try {
      session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, flagId);
      fetchSpinner.succeed(`Fetched simulator session ${session.id}`);
    } catch (err) {
      fetchSpinner.fail(`Failed to fetch simulator session ${flagId}`);
      throw err;
    }

    const deviceRunSessionUrl = getDeviceRunSessionUrl(
      session.app.ownerAccount.name,
      session.app.slug,
      session.id
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        type: deviceRunSessionTypeToFlagValue(session.type),
        status: session.status,
        deviceRunSessionUrl,
        remoteConfig: session.remoteConfig,
      });
      return;
    }

    Log.newLine();
    Log.log(`ID:       ${session.id}`);
    Log.log(`Type:     ${session.type}`);
    Log.log(`Status:   ${session.status}`);
    Log.log(`URL:      ${link(deviceRunSessionUrl)}`);

    if (session.status === DeviceRunSessionStatus.InProgress) {
      Log.newLine();
      if (session.remoteConfig) {
        Log.log(formatRemoteSessionInstructions(session.remoteConfig, 'env'));
      } else {
        Log.log(
          '⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.'
        );
      }
    }
  }
}
