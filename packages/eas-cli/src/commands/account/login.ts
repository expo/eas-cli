import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { showLoginPromptAsync } from '../../user/actions';

export default class AccountLogin extends EasCommand {
  static description = 'log in with your Expo account';
  static aliases = ['login'];

  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    Log.log('Log in to EAS');
    await showLoginPromptAsync();
    Log.log('Logged in');
  }
}
