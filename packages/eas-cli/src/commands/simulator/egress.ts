import { Flags } from '@oclif/core';

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
  static override description = `[EXPERIMENTAL] run the local egress client for a simulator session to route proxied HTTP(S) requests through this machine`;

  static override flags = {
    'config-type': Flags.option({
      description: `Read session credentials from ${SIMULATOR_DOTENV_FILE_NAME} (dotenv) or the current shell environment (env).`,
      options: ['dotenv', 'env'] as const,
      default: 'dotenv',
    })(),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorEgress);
    const { projectDir } = await this.getContextAsync(SimulatorEgress, {
      nonInteractive: true,
    });
    if (flags['config-type'] === 'dotenv') {
      await loadSimulatorEnvAsync(projectDir);
    }

    const egress = readLocalEgressConfigFromEnv(process.env);
    const deviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];

    Log.log(
      `Starting the local egress client${
        deviceRunSessionId ? ` for simulator session ${deviceRunSessionId}` : ''
      }. When connected, proxied HTTP(S) requests can use this machine's network.`
    );
    Log.log(
      'Press Ctrl+C to stop the egress client. The simulator session keeps running; ' +
        `proxied HTTP(S) requests are unavailable until the tunnel reconnects. Stop the session with \`eas simulator:stop${deviceRunSessionId ? ` --id ${deviceRunSessionId}` : ''}\`.`
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
          Log.succeed('Egress tunnel connected.');
        },
        onDisconnected: () => {
          Log.warn(
            'Egress tunnel disconnected; reconnecting. Proxied HTTP(S) requests are unavailable until it reconnects.'
          );
        },
      });
    } finally {
      process.removeListener('SIGINT', handleSigint);
    }
    Log.log('Egress client stopped.');
  }
}
