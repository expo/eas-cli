import EasCommand from '../commandUtils/EasCommand.js';
import { SelectPlatform } from '../credentials/manager/SelectPlatform.js';

export default class Credentials extends EasCommand {
  static description = 'manage credentials';

  async runAsync(): Promise<void> {
    await new SelectPlatform().runAsync();
  }
}
