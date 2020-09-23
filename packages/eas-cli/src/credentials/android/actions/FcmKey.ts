import chalk from 'chalk';

import log from '../../../log';
import { prompt } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';

export class UpdateFcmKey implements Action {
  constructor(private experienceName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { fcmApiKey } = await prompt([
      {
        type: 'text',
        name: 'fcmApiKey',
        message: 'FCM Api Key',
        validate: (value: string) => value.length > 0 || "FCM Api Key can't be empty",
      },
    ]);

    await ctx.android.updateFcmKeyAsync(this.experienceName, fcmApiKey);
    log(chalk.green('Updated successfully'));
  }
}
