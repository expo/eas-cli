import { Command } from '@oclif/command';

import { loginAsync } from '../accounts';
import { prompt } from '../prompts';
import { loginAsync } from '../user/actions';

export default class Login extends Command {
  static description = 'log in with your EAS account';

  async run() {
    this.log('Log in to EAS');
    await loginAsync();
    this.log('Logged in.');
  }
}
