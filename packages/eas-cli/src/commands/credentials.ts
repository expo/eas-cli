import EasCommand from '../commandUtils/EasCommand';
import { createCredentialsContextAsync } from '../credentials/context';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static description = 'Manage your credentials';

  async run() {
    const ctx = await createCredentialsContextAsync(process.cwd(), {});
    await new SelectPlatform().runAsync(ctx);
  }
}
