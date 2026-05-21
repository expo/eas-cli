import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorStop extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] stop a remote simulator session on EAS by its device run session ID';

  static override flags = {
    id: Flags.string({
      description: 'Device run session ID',
      required: true,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorStop);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorStop, {
      nonInteractive,
    });

    const stopSpinner = ora(`🛑 Stopping device run session ${flags.id}`).start();
    try {
      const session = await DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync(
        graphqlClient,
        flags.id
      );
      stopSpinner.succeed(`🎉 Device run session ${session.id} is ${session.status.toLowerCase()}`);

      if (jsonFlag) {
        printJsonOnlyOutput({ id: session.id, status: session.status });
      }
    } catch (err) {
      stopSpinner.fail(`Failed to stop device run session ${flags.id}`);
      throw err;
    }
  }
}
