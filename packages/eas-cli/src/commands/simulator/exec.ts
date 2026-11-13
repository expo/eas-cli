import spawnAsync from '@expo/spawn-async';
import { constants } from 'node:os';

import EasCommand from '../../commandUtils/EasCommand';
import {
  SIMULATOR_DOTENV_FILE_NAME,
  getSimulatorEnvFilePath,
  loadSimulatorEnvAsync,
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
    await loadSimulatorEnvAsync(projectDir);
    const configurationError = getControllerEnvironmentError(process.env);
    if (configurationError) {
      throw new Error(
        `${configurationError}\nRun eas simulator:start to save a new connection.\nFor an existing session, run eas simulator:get --id <session-id> and run your client with the settings it prints.\nConnection file: ${getSimulatorEnvFilePath(projectDir)}`
      );
    }

    this.isRunningSubprocess = true;
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  }

  protected override catch(err: Error): Promise<void> {
    // A child that started owns its output. Preserve its failure status without
    // adding another diagnostic or printing its command arguments.
    if (this.isRunningSubprocess) {
      const { status, signal } = err as Error & { status?: number; signal?: NodeJS.Signals };
      if (typeof status === 'number' && status > 0) {
        process.exitCode = status;
        return Promise.resolve();
      }
      if (signal && constants.signals[signal]) {
        process.exitCode = 128 + constants.signals[signal];
        return Promise.resolve();
      }
    }
    // Preflight and spawn errors have no child diagnostic. Let oclif print them
    // once, without EasCommand's additional generic failure message.
    this.error(err.message, { exit: 1 });
  }
}

function getControllerEnvironmentError(env: NodeJS.ProcessEnv): string | undefined {
  const controllers = [
    {
      name: 'agent-device',
      url: 'AGENT_DEVICE_DAEMON_BASE_URL',
      required: ['AGENT_DEVICE_DAEMON_AUTH_TOKEN'],
      optional: [],
    },
    { name: 'Argent', url: 'ARGENT_TOOLS_URL', required: [], optional: ['ARGENT_AUTH_TOKEN'] },
    { name: 'Appium', url: 'APPIUM_URL', required: ['APPIUM_CAPS'], optional: [] },
  ];
  let hasController = false;
  for (const controller of controllers) {
    const required = [controller.url, ...controller.required];
    const variables = [...required, ...controller.optional];
    if (variables.every(key => env[key] === undefined)) {
      continue;
    }
    hasController = true;
    const missing = required.filter(key => !env[key]?.trim());
    if (missing.length > 0) {
      return `No remote simulator connection is configured. Missing ${missing.join(', ')} for ${controller.name}.`;
    }
    try {
      const url = new URL(env[controller.url] ?? '');
      if (!['http:', 'https:'].includes(url.protocol)) {
        return `${controller.url} must be an HTTP or HTTPS URL.`;
      }
    } catch {
      return `${controller.url} must be an HTTP or HTTPS URL.`;
    }
  }
  if (!hasController) {
    return 'No remote simulator connection is configured.';
  }
  if (env.APPIUM_CAPS !== undefined) {
    try {
      const capabilities: unknown = JSON.parse(env.APPIUM_CAPS);
      if (
        capabilities === null ||
        typeof capabilities !== 'object' ||
        Array.isArray(capabilities)
      ) {
        return 'APPIUM_CAPS must be a JSON object.';
      }
    } catch {
      return 'APPIUM_CAPS must be a JSON object.';
    }
  }
  return undefined;
}
