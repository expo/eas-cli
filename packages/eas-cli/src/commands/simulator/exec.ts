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

  async runAsync(): Promise<void> {
    const { projectDir } = await this.getContextAsync(SimulatorExec, {
      nonInteractive: true,
    });
    await loadSimulatorEnvAsync(projectDir);

    const [command, ...args] = this.argv as [string, ...string[]];
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  }

  // eslint-disable-next-line async-protect/async-suffix
  protected override async catch(err: Error): Promise<any> {
    process.exitCode = process.exitCode ?? (err as any).status ?? 1;
  }
}
