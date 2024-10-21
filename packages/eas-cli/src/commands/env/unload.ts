import * as fs from 'fs-extra';
import { exists } from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';

const EnvLocalFile = '.env.local';
const EnvOriginalLocalFile = `${EnvLocalFile}.original`;

export default class EnvironmentVariableUnload extends EasCommand {
  static override description = 'unload environment variables';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { projectDir } = await this.getContextAsync(EnvironmentVariableUnload, {
      nonInteractive: true,
    });

    const envLocalFile = path.resolve(projectDir, EnvLocalFile);
    const envOriginalLocalFile = path.resolve(projectDir, EnvOriginalLocalFile);

    if (await exists(envOriginalLocalFile)) {
      await fs.rename(envOriginalLocalFile, envLocalFile);
    } else {
      await fs.remove(envLocalFile);
    }
    Log.log(`Unloaded environment variables.`);
  }
}
