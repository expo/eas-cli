import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import { ora } from '../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorStop extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] stop a remote simulator session on EAS by its device run session ID';

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
    const { flags } = await this.parse(SimulatorStop);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorStop, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const flagId = flags.id || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!flagId) {
      throw new Error('Missing required flag id');
    }

    const stopSpinner = ora(`🛑 Stopping device run session ${flagId}`).start();
    let session;
    try {
      session = await DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync(
        graphqlClient,
        flagId
      );
      stopSpinner.succeed(`🎉 Device run session ${session.id} is ${session.status.toLowerCase()}`);
    } catch (err) {
      stopSpinner.fail(`Failed to stop device run session ${flagId}`);
      throw err;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ id: session.id, status: session.status });
    }
  }
}
