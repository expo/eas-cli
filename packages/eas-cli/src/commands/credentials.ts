import EasCommand from '../commandUtils/EasCommand';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static description = 'manage credentials';

  async runAsync(): Promise<void> {
    await new SelectPlatform().runAsync();
  }
}
