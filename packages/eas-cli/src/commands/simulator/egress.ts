import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { readLocalEgressConfigFromEnv, runLocalEgressAsync } from '../../simulator/egress';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';

export default class SimulatorEgress extends EasCommand {
  static override hidden = true;
  static override aliases = ['sim:egress'];
  static override description = `[EXPERIMENTAL] run the local egress client for the simulator session in ${SIMULATOR_DOTENV_FILE_NAME}, so the simulator's network traffic exits from this machine`;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    await this.parse(SimulatorEgress);
    const { projectDir } = await this.getContextAsync(SimulatorEgress, {
      nonInteractive: true,
    });
    await loadSimulatorEnvAsync(projectDir);

    const egress = readLocalEgressConfigFromEnv(process.env);
    const deviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];

    Log.log(
      `Starting the local egress client${
        deviceRunSessionId ? ` for simulator session ${deviceRunSessionId}` : ''
      }. While it runs, the simulator's network traffic exits from this machine.`
    );
    Log.log(
      'Press Ctrl+C to stop the egress client. The simulator session keeps running without ' +
        'internet access until the client runs again; stop the session with `eas simulator:stop`.'
    );
    Log.newLine();

    const abortController = new AbortController();
    const handleSigint = (): void => {
      abortController.abort();
    };
    process.on('SIGINT', handleSigint);
    try {
      await runLocalEgressAsync({
        ...egress,
        signal: abortController.signal,
        onConnected: () => {
          Log.succeed("Egress connected. Simulator traffic now exits from this machine's network.");
        },
        onDisconnected: () => {
          Log.warn(
            'Egress tunnel disconnected; reconnecting. The simulator has no internet access until it reconnects.'
          );
        },
      });
    } finally {
      process.removeListener('SIGINT', handleSigint);
    }
    Log.log('Egress client stopped.');
  }
}
