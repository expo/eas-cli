import spawnAsync from '@expo/spawn-async';

import EasCommand from '../../commandUtils/EasCommand';
import { SIMULATOR_DOTENV_FILE_NAME, loadSimulatorEnvAsync } from '../../simulator/env';

export default class SimulatorExec extends EasCommand {
  static override hidden = true;
  static override description = `[EXPERIMENTAL] execute a simulator command with ${SIMULATOR_DOTENV_FILE_NAME} environment loaded`;
  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  private isRunningSubprocess = false;

  async runAsync(): Promise<void> {
    const [command, ...args] = this.argv;
    if (!command) {
      throw new Error('No command provided. Run `eas simulator:exec <command> [args...]`.');
    }

    const { projectDir } = await this.getContextAsync(SimulatorExec, {
      nonInteractive: true,
    });
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
