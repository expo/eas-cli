import { getConfig } from '@expo/config';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { findProjectRootAsync, setProjectIdAsync } from '../../project/projectUtils';

export default class ProjectInit extends EasCommand {
  static description = 'create or link an EAS project';
  static aliases = ['init'];

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

    if (exp.extra?.eas?.projectId) {
      Log.error(
        `app.json is already linked to project with ID: ${chalk.bold(exp.extra?.eas?.projectId)}`
      );
      return;
    }

    await setProjectIdAsync(projectDir);
  }
}
