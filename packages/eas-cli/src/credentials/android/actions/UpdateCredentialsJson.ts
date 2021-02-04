import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateAndroidCredentialsAsync } from '../../credentialsJson/update';

export class UpdateCredentialsJson implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    Log.log('Updating Android credentials in credentials.json');
    await updateAndroidCredentialsAsync(ctx);
    Log.succeed(
      'Android part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
