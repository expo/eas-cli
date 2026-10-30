import { Args, Flags } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import Log from '../../../log';
import {
  assertControlKeepAliveSupported,
  createControlConnectionIdentityAsync,
  inspectControlConnectionAsync,
  openControlConnectionAsync,
} from '../../../simulator/controlConnection';
import { loadControlSessionAsync } from '../../../simulator/controlSession';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../../simulator/env';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import { sanitizeTerminalText } from '../../../utils/terminalText';
import { formatMilliseconds } from '../../../utils/timer';

export default class SimulatorControlConnection extends EasCommand {
  static override description =
    'optionally keep a simulator control connection available between commands';
  static override args = {
    operation: Args.string({
      required: true,
      options: ['open', 'status', 'close'],
      description: 'Open, inspect or close the local control connection',
    }),
  };
  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    'idle-timeout': Flags.integer({
      min: 1,
      max: 86_400,
      description: 'Seconds of idle time before closing the control connection (default: 120)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };
  static override examples = [
    '$ eas simulator:control:connection open --idle-timeout 300',
    '$ eas simulator:control:connection status --id <session-id> --json',
    '$ eas simulator:control:connection close',
  ];
  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(SimulatorControlConnection);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }
    if (flags.id === '') {
      throw new Error('--id needs a simulator session ID.');
    }
    if (flags['idle-timeout'] !== undefined && args.operation !== 'open') {
      throw new Error('--idle-timeout applies only to connection open.');
    }
    const idleTimeoutMs =
      flags['idle-timeout'] !== undefined ? flags['idle-timeout'] * 1_000 : undefined;
    assertControlKeepAliveSupported();
    const {
      projectDir,
      loggedIn: { graphqlClient, authenticationInfo },
    } = await this.getContextAsync(SimulatorControlConnection, { nonInteractive });
    await loadSimulatorEnvAsync(projectDir);
    const sessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!sessionId) {
      throw new Error(
        'No simulator session ID provided. Pass --id, or run eas simulator:start first.'
      );
    }
    const identity = await createControlConnectionIdentityAsync(
      sessionId,
      projectDir,
      authenticationInfo
    );
    const info =
      args.operation === 'open'
        ? await openControlConnectionAsync(
            identity,
            () => loadControlSessionAsync(graphqlClient, sessionId),
            idleTimeoutMs
          )
        : await inspectControlConnectionAsync(identity, {
            operation: args.operation === 'close' ? 'close' : 'status',
          });
    if (json) {
      printJsonOnlyOutput({
        connected: Boolean(info) && args.operation !== 'close',
        id: sessionId,
        connection: args.operation === 'close' ? null : info,
      });
    } else if (args.operation === 'close') {
      Log.succeed(
        info
          ? 'Control connection closing. The simulator session continues.'
          : 'No control connection is open.'
      );
    } else if (!info) {
      Log.log('No control connection is open. Regular control commands are available.');
    } else {
      Log.log(
        `${sanitizeTerminalText(info.session.device.name ?? 'iOS Simulator')} · ${sessionId}`
      );
      Log.log(
        `Control connection ${info.busy ? 'busy' : 'ready'} · idle timeout: ${formatMilliseconds(info.idleTimeoutMs)}`
      );
      if (info.idleDeadline !== null) {
        Log.log(
          `Closes in ${formatMilliseconds(Math.max(0, info.idleDeadline - Date.now())) || '<1s'}`
        );
      }
    }
  }
}
