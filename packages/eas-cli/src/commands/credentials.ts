import { Command } from '@oclif/command';

import { runStandaloneCredentialsManagerAsync } from '../credentials/CredentialsManager';
import { createCredentialsContextAsync } from '../credentials/context';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

export default class Credentials extends Command {
  static description = 'Manage your credentials';

  async run() {
    const ctx = await createCredentialsContextAsync(process.cwd(), {});
    await runStandaloneCredentialsManagerAsync(ctx, new SelectPlatform());
  }
}
