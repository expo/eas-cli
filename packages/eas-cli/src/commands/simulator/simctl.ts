import EasCommand from '../../commandUtils/EasCommand';
import { AppPlatform, DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  getServeSimDeviceUdidAsync,
  getServeSimHost,
  runServeSimHostActionAsync,
} from '../../simulator/serveSimHost';
import { SUPPORTED_SIMCTL_COMMANDS, resolveSimctlHostAction } from '../../simulator/simctl';

export function parseSimctlArgv(rawArgv: string[]): { id?: string; args: string[] } {
  let id: string | undefined;
  let index = 0;
  while (index < rawArgv.length) {
    const arg = rawArgv[index];
    if (arg === '--') {
      index += 1;
      break;
    }
    if (arg === '--id') {
      id = rawArgv[index + 1];
      if (!id) {
        throw new Error('--id needs a simulator session ID.');
      }
      index += 2;
    } else if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length);
      index += 1;
    } else {
      break;
    }
  }
  return { id, args: rawArgv.slice(index) };
}

export default class SimulatorSimctl extends EasCommand {
  static override aliases = ['sim:simctl'];
  static override description = `[EXPERIMENTAL] run a supported simctl command on a remote iOS simulator session, without the device argument. Supported: ${SUPPORTED_SIMCTL_COMMANDS.map(
    command => `\`${command}\``
  ).join(', ')}`;
  static override strict = false;
  static override usage = ['simulator:simctl [--id <value>] <simctl arguments...>'];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const rawArgv = [...this.argv];
    await this.parse(SimulatorSimctl, []);
    const { id: flagId, args } = parseSimctlArgv(rawArgv);

    const hostAction = resolveSimctlHostAction(args);
    if (!hostAction) {
      throw new Error(
        `Unsupported simctl command${args.length > 0 ? `: ${args.join(' ')}` : ''}. Supported commands, without the device argument:\n${SUPPORTED_SIMCTL_COMMANDS.map(
          command => `  ${command}`
        ).join('\n')}`
      );
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorSimctl, { nonInteractive: true });

    await loadSimulatorEnvAsync(projectDir);
    const sessionId = flagId || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!sessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
    if (session.platform !== AppPlatform.Ios) {
      throw new Error(`simulator:simctl only supports iOS simulator sessions.`);
    }
    if (session.status !== DeviceRunSessionStatus.InProgress) {
      throw new Error(
        `Simulator session ${session.id} is ${session.status.toLowerCase()}, not running.`
      );
    }
    const host = session.remoteConfig ? getServeSimHost(session.remoteConfig) : null;
    if (!host) {
      throw new Error(`Simulator session ${session.id} has no simulator host to run simctl on.`);
    }

    const udid = await getServeSimDeviceUdidAsync(host);
    const { stdout, stderr } = await runServeSimHostActionAsync(host, hostAction.action, {
      ...hostAction.params,
      udid,
    });
    if (stdout) {
      Log.log(stdout.trimEnd());
    }
    if (stderr) {
      Log.warn(stderr.trimEnd());
    }
  }
}
