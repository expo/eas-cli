import {
  AndroidFcmFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams } from '../api/GraphqlClient.js';

export class AssignFcm {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    fcm: AndroidFcmFragment
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const appCredentials =
      await ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(this.app);
    const updatedAppCredentials = await ctx.android.updateAndroidAppCredentialsAsync(
      appCredentials,
      {
        androidFcmId: fcm.id,
      }
    );
    Log.succeed(`FCM API Key assigned to ${this.app.androidApplicationIdentifier}`);
    return updatedAppCredentials;
  }
}
