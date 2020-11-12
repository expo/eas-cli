import chalk from 'chalk';

import { getBundleIdentifier } from '../../../build/ios/bundleIdentifer';
import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateIosCredentialsAsync } from '../../credentialsJson/update';
import { AppLookupParams } from '../credentials';

export class UpdateCredentialsJson implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const bundleIdentifer = await getBundleIdentifier(ctx.projectDir, ctx.exp);
    log('Updating content of credentials.json');
    await updateIosCredentialsAsync(ctx, bundleIdentifer);
    log(
      chalk.green(
        'iOS part of your local credentials.json is synced with values store on Expo servers.'
      )
    );
  }
}
