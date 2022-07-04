import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand.js';
import Log from '../../log.js';
import { getExpoConfig } from '../../project/expoConfig.js';
import { findProjectRootAsync, setProjectIdAsync } from '../../project/projectUtils.js';

export default class ProjectInit extends EasCommand {
  static description = 'create or link an EAS project';
  static aliases = ['init'];

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    if (exp.extra?.eas?.projectId) {
      Log.error(
        `app.json is already linked to project with ID: ${chalk.bold(exp.extra?.eas?.projectId)}`
      );
      return;
    }

    await setProjectIdAsync(projectDir);
  }
}
