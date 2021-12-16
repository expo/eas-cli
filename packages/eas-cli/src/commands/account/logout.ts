import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { logoutAsync } from '../../user/User';

export default class AccountLogout extends EasCommand {
  static description = 'log out';
  static aliases = ['logout'];

  protected mustBeRunInsideAnExpoProject = false;
  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    await logoutAsync();
    Log.log('Logged out');
  }
}
