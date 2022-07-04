import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { updateAndroidCredentialsAsync } from '../../credentialsJson/update.js';

export class UpdateCredentialsJson {
  async runAsync(
    ctx: CredentialsContext,
    buildCredentials: AndroidAppBuildCredentialsFragment
  ): Promise<void> {
    Log.log('Updating Android credentials in credentials.json');
    await updateAndroidCredentialsAsync(ctx, buildCredentials);
    Log.succeed(
      'Android part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
