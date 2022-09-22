import EasCommand, { CommandConfiguration } from '../../commandUtils/EasCommand';
import Log from '../../log';
import { logoutAsync } from '../../user/User';

export default class AccountLogout extends EasCommand {
  static override description = 'log out';
  static override aliases = ['logout'];

  protected override commandConfiguration: CommandConfiguration = {
    canRunOutsideProject: true,
  };

  async runAsync(): Promise<void> {
    await logoutAsync();
    Log.log('Logged out');
  }
}
