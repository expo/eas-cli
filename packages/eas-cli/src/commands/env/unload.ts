import * as fs from 'fs-extra';
import { exists } from 'fs-extra';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';

const EnvLocalFile = '.env.local';
const EnvOriginalLocalFile = `${EnvLocalFile}.original`;

export default class EnvironmentVariableUnload extends EasCommand {
  static override description = 'unload environment variables';

  static override hidden = true;

  async runAsync(): Promise<void> {
    if (await exists(EnvOriginalLocalFile)) {
      await fs.rename(EnvOriginalLocalFile, EnvLocalFile);
    } else {
      await fs.remove(EnvLocalFile);
    }
    Log.log(`Unloaded environment variables.`);
  }
}
