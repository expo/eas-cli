import { loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EAS_SIMULATOR_SESSION_ID,
  EAS_SIMULATOR_SESSION_STATUS,
  EAS_SIMULATOR_SESSION_STATUS_STARTING,
  SIMULATOR_DOTENV_FILE_NAME,
  applySimulatorEnv,
  getSimulatorEnvFilePath,
  readSimulatorEnvAsync,
} from '../../simulator/env';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';

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
    // Read the file once and use this snapshot for both the checks and the environment, so that a
    // concurrent `eas simulator:stop` or `eas simulator:start` cannot change it between the two.
    const simulatorEnv = await readSimulatorEnvAsync(projectDir);
    const simulatorEnvFilePath = getSimulatorEnvFilePath(projectDir);
    // Without the session's connection variables, tools such as agent-device fall back to devices
    // on this machine. Fail instead of running the command against a local device.
    const sessionId = simulatorEnv?.[EAS_SIMULATOR_SESSION_ID];
    if (!simulatorEnv || !sessionId) {
      throw new Error(await getNoSessionErrorMessageAsync(projectDir));
    }
    if (simulatorEnv[EAS_SIMULATOR_SESSION_STATUS] === EAS_SIMULATOR_SESSION_STATUS_STARTING) {
      throw new Error(
        `Simulator session ${sessionId} in ${simulatorEnvFilePath} is still starting. ` +
          'Wait until `eas simulator:start` reports that the session is ready, then run this command again. ' +
          'If `eas simulator:start` is no longer running, start a new session with `eas simulator:start`.'
      );
    }

    loadProjectEnv(projectDir, { silent: true });
    applySimulatorEnv(simulatorEnv);
    for (const [key, value] of Object.entries(simulatorEnv)) {
      // Like loadEnvFiles: keep values that are already set, without reading the file again.
      process.env[key] ??= value;
    }

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

async function getNoSessionErrorMessageAsync(projectDir: string): Promise<string> {
  const lines = [
    `No simulator session found in ${getSimulatorEnvFilePath(projectDir)}. ` +
      `eas simulator:exec reads ${SIMULATOR_DOTENV_FILE_NAME} from the project directory, which is the nearest directory with a package.json.`,
  ];
  const parentSessionDir = await findParentDirWithSessionAsync(projectDir);
  if (parentSessionDir) {
    lines.push(
      `${getSimulatorEnvFilePath(parentSessionDir)} has a simulator session. To use it, run this command from ${parentSessionDir}.`
    );
  }
  lines.push(
    'To start a session for this project, run `eas simulator:start` from this directory.',
    `A session started with \`--out-config-type env\` does not write ${SIMULATOR_DOTENV_FILE_NAME}. For that session, run the command without eas simulator:exec.`
  );
  return lines.join('\n');
}

async function findParentDirWithSessionAsync(projectDir: string): Promise<string | null> {
  let dir = projectDir;
  while (dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
    try {
      if ((await readSimulatorEnvAsync(dir))?.[EAS_SIMULATOR_SESSION_ID]) {
        return dir;
      }
    } catch {
      // The hint is optional. An unreadable file in a parent directory must not hide the error.
    }
  }
  return null;
}
