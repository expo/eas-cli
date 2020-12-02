import { Command, flags } from '@oclif/command';

import { configureAsync } from '../../build/configure';
import { BuildCommandPlatform } from '../../build/types';
import log from '../../log';
import { findProjectRootAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

export default class BuildConfigure extends Command {
  static description = 'Configure the project to support EAS Build.';

  static flags = {
    platform: flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
      default: 'all',
    }),
    'allow-experimental': flags.boolean({
      description: 'Enable experimental configuration steps.',
      default: false,
    }),
  };

  async run() {
    const { flags } = this.parse(BuildConfigure);
    const platform = flags.platform as BuildCommandPlatform;
    const allowExperimental = flags['allow-experimental'];
    if (allowExperimental) {
      log.warn(
        'Project configuration will execute some additional steps that might fail if structure of your native project is significantly different from "expo eject" or "expo init"'
      );
    }

    await ensureLoggedInAsync();
    await configureAsync({
      platform,
      allowExperimental,
      projectDir: (await findProjectRootAsync()) ?? process.cwd(),
    });
  }
}
