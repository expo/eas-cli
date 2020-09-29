import { Command } from '@oclif/command';

import { showLoginPromptAsync } from '../user/actions';

export default class Login extends Command {
  static description = 'log in with your EAS account';

  async run() {
    this.log('Log in to EAS');
    await showLoginPromptAsync();
    this.log('Logged in.');
  }
}
