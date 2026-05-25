import { Flags } from '@oclif/core';

import { getBareJobRunUrl } from '../../build/utils/url';
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
    '[EXPERIMENTAL] get info about a remote simulator session on EAS by its device run session ID';

  static override flags = {
    id: Flags.string({
      description: `Device run session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
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
      throw new Error('Missing required flag id');
    }

    const fetchSpinner = ora(`Fetching device run session ${flagId}`).start();
    let session;
    try {
      session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, flagId);
      fetchSpinner.succeed(`Fetched device run session ${session.id}`);
    } catch (err) {
      fetchSpinner.fail(`Failed to fetch device run session ${flagId}`);
      throw err;
    }

    const jobRunUrl = session.turtleJobRun
      ? getBareJobRunUrl(session.app.ownerAccount.name, session.app.slug, session.turtleJobRun.id)
      : '';

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        type: deviceRunSessionTypeToFlagValue(session.type),
        status: session.status,
        jobRunUrl: jobRunUrl || undefined,
        remoteConfig: session.remoteConfig,
      });
      return;
    }

    Log.newLine();
    Log.log(`ID:       ${session.id}`);
    Log.log(`Type:     ${session.type}`);
    Log.log(`Status:   ${session.status}`);
    Log.log(`URL:      ${jobRunUrl ? link(jobRunUrl) : ''}`);

    if (session.status === DeviceRunSessionStatus.InProgress) {
      Log.newLine();
      if (session.remoteConfig) {
        Log.log(formatRemoteSessionInstructions(session.remoteConfig));
      } else {
        Log.log(
          '⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.'
        );
      }
    }
  }
}
