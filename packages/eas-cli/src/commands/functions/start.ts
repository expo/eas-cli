import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { installNodeDependenciesAsync } from '../../functions/CreateApp';
import { YarnPackageManager } from '../../functions/PackageManager';
import Log from '../../log';
import { ora } from '../../ora';
import { findProjectRootAsync } from '../../project/projectUtils';

export default class FunctionsCreate extends EasCommand {
  static description = 'start a function';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const functionsBuild = 'functions-build';

    const installSpinner = ora('Installing dependencies...').start();
    await installNodeDependenciesAsync(path.join(projectDir, functionsBuild), 'yarn');
    installSpinner.succeed('Modified permissions');

    Log.log('serving up the function...');
    const yarn = new YarnPackageManager({ cwd: path.join(projectDir, functionsBuild) });
    await yarn.runAsync('dev');
  }
}
