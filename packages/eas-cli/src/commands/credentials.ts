import { Flags } from '@oclif/core';

import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectIdIfProjectDirContext,
} from '../commandUtils/EasCommand';
import { CredentialsContext } from '../credentials/context';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandProjectIdIfProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Credentials);
    const { actor, projectId } = await this.getContextAsync(Credentials, { nonInteractive: false });

    const exp = CredentialsContext.getExpoConfigInProject(process.cwd());

    await new SelectPlatform(
      actor,
      projectId && exp ? { projectId, exp } : null,
      flags.platform
    ).runAsync();
  }
}
