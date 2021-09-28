import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { updateAndroidCredentialsAsync } from '../../credentialsJson/update';

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
