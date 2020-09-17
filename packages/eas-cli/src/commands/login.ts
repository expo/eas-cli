import { Command } from '@oclif/command';

import { loginAsync } from '../accounts';
import { prompt } from '../prompts';

export default class Login extends Command {
  static description = 'log in with your EAS account';

  async run() {
    this.log('Log in to EAS');
    const { username } = await prompt({
      type: 'text',
      name: 'username',
      message: 'Email or username',
    });
    const { password } = await prompt({
      type: 'password',
      name: 'password',
      message: 'Password',
    });
    await loginAsync({
      username,
      password,
    });
    this.log('Logged in.');
  }
}
