import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import { ora } from '../../ora';

export default class SimulatorStop extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] stop a remote simulator session on EAS by its device run session ID';

  static override flags = {
    id: Flags.string({
      description: 'Device run session ID',
      required: true,
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorStop);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorStop, {
      nonInteractive: flags['non-interactive'],
    });

    const stopSpinner = ora(`🛑 Stopping device run session ${flags.id}`).start();
    try {
      const session = await DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync(
        graphqlClient,
        flags.id
      );
      stopSpinner.succeed(`🎉 Device run session ${session.id} is ${session.status.toLowerCase()}`);
    } catch (err) {
      stopSpinner.fail(`Failed to stop device run session ${flags.id}`);
      throw err;
    }
  }
}
