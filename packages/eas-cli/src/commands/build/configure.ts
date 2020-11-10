import { Command, flags } from '@oclif/command';

import { configureAsync } from '../../build/configure';
import { BuildCommandPlatform } from '../../build/types';
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
  };

  async run() {
    const { flags } = this.parse(BuildConfigure);
    const platform = flags.platform as BuildCommandPlatform;

    await ensureLoggedInAsync();
    await configureAsync({
      platform,
      projectDir: (await findProjectRootAsync()) ?? process.cwd(),
    });
  }
}
