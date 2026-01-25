import chalk from 'chalk';

import ProjectLink from './link';
import Log from '../../log';

export default class ProjectInit extends ProjectLink {
  static override description = 'create or link an EAS project';
  static override aliases = ['init'];
  static override hidden = true;

  override async runAsync(): Promise<void> {
    Log.log(chalk.dim('Tip: You can also use `eas link` for this.'));
    Log.newLine();
    await super.runAsync();
  }
}
