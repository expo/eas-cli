import { Command } from '@oclif/command';

import { createCredentialsContextAsync } from '../../credentials/context';
import { SelectPlatform } from '../../credentials/manager/SelectPlatform';
import { runCredentialsManagerStandaloneAsync } from '../../credentials/run';

export default class CredentialsManage extends Command {
  static description = 'Manage your credentials';

  async run() {
    const ctx = await createCredentialsContextAsync(process.cwd(), {});
    await runCredentialsManagerStandaloneAsync(ctx, new SelectPlatform());
  }
}
