import { Flags } from '@oclif/core';

import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectDirContext,
  EASCommandProjectIdContext,
} from '../commandUtils/EasCommand';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';
import { getExpoConfig } from '../project/expoConfig';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandProjectIdContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Credentials);
    const { actor, projectId, projectDir } = await this.getContextAsync(Credentials, {
      nonInteractive: false,
    });

    const exp = getExpoConfig(projectDir);

    await new SelectPlatform(actor, { projectId, exp }, flags.platform).runAsync();
  }
}
