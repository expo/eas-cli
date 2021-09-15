import { Command } from '@oclif/command';

import Log from '../../log';
import { showLoginPromptAsync } from '../../user/actions';

export default class AccountLogin extends Command {
  static description = 'log in with your Expo account';

  static aliases = ['login'];

  async run(): Promise<void> {
    Log.log('Log in to EAS');
    await showLoginPromptAsync();
    Log.log('Logged in');
  }
}
