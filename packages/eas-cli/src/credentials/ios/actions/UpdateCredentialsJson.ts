import { Platform } from '@expo/eas-build-job';

import Log from '../../../log';
import { ensureAppIdentifierIsDefinedAsync } from '../../../project/projectUtils';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateIosCredentialsAsync } from '../../credentialsJson/update';
import { AppLookupParams } from '../credentials';

export class UpdateCredentialsJson implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const bundleIdentifer = await ensureAppIdentifierIsDefinedAsync(ctx.projectDir, Platform.iOS);
    Log.log('Updating iOS credentials in credentials.json');
    await updateIosCredentialsAsync(ctx, bundleIdentifer);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
