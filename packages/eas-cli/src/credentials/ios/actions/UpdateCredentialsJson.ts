import { configureBundleIdentifierAsync } from '../../../build/ios/bundleIdentifer';
import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateIosCredentialsAsync } from '../../credentialsJson/update';
import { AppLookupParams } from '../credentials';

export class UpdateCredentialsJson implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const bundleIdentifer = await configureBundleIdentifierAsync(ctx.projectDir, ctx.exp);

    Log.log('Updating iOS credentials in credentials.json');
    await updateIosCredentialsAsync(ctx, bundleIdentifer);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
