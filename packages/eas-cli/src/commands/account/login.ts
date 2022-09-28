import EasCommand from '../../commandUtils/EasCommand';
import { showLoginPromptAsync } from '../../commandUtils/context/contextUtils/ensureLoggedInAsync';
import Log from '../../log';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];

  async runAsync(): Promise<void> {
    await showLoginPromptAsync();
    Log.log('Logged in');
  }
}
