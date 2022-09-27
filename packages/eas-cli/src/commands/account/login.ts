import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { showLoginPromptAsync } from '../../user/actions';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];

  async runAsync(): Promise<void> {
    await showLoginPromptAsync();
    Log.log('Logged in');
  }
}
