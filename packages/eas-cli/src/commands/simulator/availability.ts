import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionAvailabilityQuery } from '../../graphql/queries/DeviceRunSessionAvailabilityQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorAvailability extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] check whether EAS Simulator is enabled for the current project account';

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorAvailability);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorAvailability, {
      nonInteractive,
    });

    const fetchSpinner = jsonFlag ? null : ora('Checking EAS Simulator availability').start();
    let accountName: string;
    let available: boolean;
    try {
      ({ accountName, available } = await DeviceRunSessionAvailabilityQuery.byAppIdAsync(
        graphqlClient,
        projectId
      ));
      fetchSpinner?.stop();
    } catch (err) {
      fetchSpinner?.fail('Failed to check EAS Simulator availability');
      throw err;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ available, accountName });
      return;
    }

    if (available) {
      Log.log(`✅ EAS Simulator is enabled for ${accountName}.`);
      return;
    }

    Log.log(`EAS Simulator isn't available on ${accountName} yet — it's coming soon.`);
  }
}
