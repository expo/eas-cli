import EasCommand from '../../commandUtils/EasCommand';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';
import { SIMULATOR_DOTENV_FILE_NAME, loadSimulatorEnvAsync } from '../../simulator/env';
import {
  parseSimulatorExecArgv,
  spawnSimulatorExecCommandAsync,
} from '../../simulator/execFastPath';

export default class SimulatorExec extends EasCommand {
  static override aliases = getSimulatorCommandAliases('exec');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('exec');
  static override description = `execute a simulator command with ${SIMULATOR_DOTENV_FILE_NAME} environment loaded`;
  static override strict = false;
  static override skipTelemetry = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const rawArgv = [...this.argv];
    // Required to avoid `Warning: Command exec did not parse its arguments. Did you forget to call 'this.parse'?`
    await this.parse(SimulatorExec, []);

    const { command, args } = parseSimulatorExecArgv(rawArgv);

    const { projectDir } = await this.getContextAsync(SimulatorExec, {
      nonInteractive: true,
    });
    await loadSimulatorEnvAsync(projectDir);

    await spawnSimulatorExecCommandAsync(command, args);
  }
}
