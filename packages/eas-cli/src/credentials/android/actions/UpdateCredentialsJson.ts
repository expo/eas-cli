import chalk from 'chalk';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateAndroidCredentialsAsync } from '../../credentialsJson/update';

export class UpdateCredentialsJson implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    log('Updating Android credentials in credentials.json');
    await updateAndroidCredentialsAsync(ctx);
    log(
      chalk.green(
        'Android part of your local credentials.json is synced with values stored on Expo servers.'
      )
    );
  }
}
