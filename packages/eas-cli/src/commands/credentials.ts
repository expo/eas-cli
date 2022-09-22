import { Flags } from '@oclif/core';

import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectIdContext,
} from '../commandUtils/EasCommand';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync } from '../project/projectUtils';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandProjectIdContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Credentials);
    const { actor, projectId } = await this.getContextAsync(Credentials, { nonInteractive: false });

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    await new SelectPlatform(actor, { projectId, exp }, flags.platform).runAsync();
  }
}
