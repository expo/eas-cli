import {
  AndroidFcmFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export class AssignFcm {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: Context,
    fcm: AndroidFcmFragment
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const appCredentials = await ctx.newAndroid.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
      this.app
    );
    const updatedAppCredentials = await ctx.newAndroid.updateAndroidAppCredentialsAsync(
      appCredentials,
      {
        androidFcmId: fcm.id,
      }
    );
    Log.succeed(`FCM API Key assigned to ${this.app.androidApplicationIdentifier}`);
    return updatedAppCredentials;
  }
}
