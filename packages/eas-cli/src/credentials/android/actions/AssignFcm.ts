import {
  AndroidFcmFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

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
