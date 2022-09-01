import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { logoutAsync } from '../../user/User';

export default class AccountLogout extends EasCommand {
  static override description = 'log out';
  static override aliases = ['logout'];

  protected override mustBeRunInsideProject = false;
  protected override requiresAuthentication = false;

  async runAsync(): Promise<void> {
    await logoutAsync();
    Log.log('Logged out');
  }
}
