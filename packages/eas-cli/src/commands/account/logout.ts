import EasCommand from '../../commandUtils/EasCommand.js';
import Log from '../../log.js';
import { logoutAsync } from '../../user/User.js';

export default class AccountLogout extends EasCommand {
  static description = 'log out';
  static aliases = ['logout'];

  protected mustBeRunInsideProject = false;
  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    await logoutAsync();
    Log.log('Logged out');
  }
}
