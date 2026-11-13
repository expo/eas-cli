import spawnAsync from '@expo/spawn-async';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  getSimulatorEnvFilePath,
  loadSimulatorEnvAsync,
  readSimulatorEnvAsync,
} from '../../simulator/env';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';

const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'bun', 'pnpm', 'pnpx', 'yarn', 'npm']);
const PACKAGE_RUNNER_SUBCOMMANDS = new Set(['exec', 'dlx', 'x']);

export default class SimulatorExec extends EasCommand {
  static override aliases = getSimulatorCommandAliases('exec');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('exec');
  static override description = `execute a simulator command with ${SIMULATOR_DOTENV_FILE_NAME} environment loaded`;
  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  private isRunningSubprocess = false;

  async runAsync(): Promise<void> {
    const rawArgv = [...this.argv];
    // Required to avoid `Warning: Command exec did not parse its arguments. Did you forget to call 'this.parse'?`
    await this.parse(SimulatorExec, []);

    const [command, ...args] = rawArgv;
    if (typeof command !== 'string' || command.length === 0) {
      throw new Error('No command provided. Run `eas simulator:exec <command> [args...]`.');
    }

    const { projectDir } = await this.getContextAsync(SimulatorExec, {
      nonInteractive: true,
    });
    const simulatorEnv = await readSimulatorEnvAsync(projectDir);
    const simulatorEnvFilePath = getSimulatorEnvFilePath(projectDir);
    // Without the session's connection variables, tools such as agent-device fall back to
    // devices on this machine. Fail instead of running the command against a local device.
    if (!simulatorEnv?.[EAS_SIMULATOR_SESSION_ID]) {
      throw new Error(
        `No simulator session found in ${simulatorEnvFilePath}. ` +
          `eas simulator:exec reads ${SIMULATOR_DOTENV_FILE_NAME} from the project directory (the nearest directory with a package.json). ` +
          'Run `eas simulator:start` from this project, or run this command from the project where you started the session.'
      );
    }
    if (isAgentDeviceCommand(command, args) && !simulatorEnv.AGENT_DEVICE_DAEMON_BASE_URL) {
      throw new Error(
        `Simulator session ${simulatorEnv[EAS_SIMULATOR_SESSION_ID]} in ${simulatorEnvFilePath} has no agent-device connection. ` +
          'Wait until `eas simulator:start` reports that the session is ready, or start a session with `--type agent-device`.'
      );
    }

    await loadSimulatorEnvAsync(projectDir);

    this.isRunningSubprocess = true;
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  }

  protected override catch(err: Error): Promise<any> {
    // Propagate wrapped command from spawnAsync rejection
    if (this.isRunningSubprocess) {
      process.exitCode = process.exitCode ?? (err as any).status ?? 1;
      return Promise.resolve();
    }
    return super.catch(err);
  }
}

/**
 * Whether the command runs agent-device, directly (`agent-device`, `./node_modules/.bin/agent-device`)
 * or through a package runner (`npx agent-device@latest`, `bunx agent-device`, `pnpm dlx agent-device`).
 */
export function isAgentDeviceCommand(command: string, args: string[]): boolean {
  if (isAgentDeviceExecutable(command)) {
    return true;
  }
  if (!PACKAGE_RUNNERS.has(path.basename(command))) {
    return false;
  }
  const packageArg = args.find(arg => !arg.startsWith('-') && !PACKAGE_RUNNER_SUBCOMMANDS.has(arg));
  return packageArg !== undefined && isAgentDeviceExecutable(packageArg);
}

function isAgentDeviceExecutable(value: string): boolean {
  return /^agent-device(@[^/\\]+)?$/.test(path.basename(value));
}
