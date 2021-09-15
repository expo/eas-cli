import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import chalk from 'chalk';

import Log from '../../log';
import { findProjectRootAsync, setProjectIdAsync } from '../../project/projectUtils';

export default class ProjectInit extends Command {
  static description = 'create or link an EAS project';
  static aliases = ['init'];

  async run(): Promise<void> {
    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
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
