import EasCommand from '../commandUtils/EasCommand';
import { CredentialsContext } from '../credentials/context';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';
import { ensureLoggedInAsync } from '../user/actions';

export default class Credentials extends EasCommand {
  static description = 'manage your credentials';

  async runAsync(): Promise<void> {
    const ctx = new CredentialsContext({
      projectDir: process.cwd(),
      user: await ensureLoggedInAsync(),
    });
    await new SelectPlatform().runAsync(ctx);
  }
}
