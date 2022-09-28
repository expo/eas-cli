import EasCommand from '../../commandUtils/EasCommand';
import ActorContextField from '../../commandUtils/context/ActorContextField';
import Log from '../../log';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];

  async runAsync(): Promise<void> {
    await ActorContextField['showLoginPromptAsync']();
    Log.log('Logged in');
  }
}
