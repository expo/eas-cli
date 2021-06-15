import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Context } from '../../context';
import { AppLookupParams, formatProjectFullName } from '../api/GraphqlClient';

export class RemoveFcm {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: Context): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(
        "Deleting an FCM Api Key is a destructive operation. Start the CLI without the '--non-interactive' flag to delete the credentials."
      );
    }
    const appCredentials = await ctx.newAndroid.getAndroidAppCredentialsWithCommonFieldsAsync(
      this.app
    );
    const fcm = appCredentials?.androidFcm;
    if (!fcm) {
      Log.warn(
        `There is no valid FCM Api Key defined for ${formatProjectFullName(this.app)}, ${
          this.app.androidApplicationIdentifier
        }`
      );
      return;
    }

    const confirm = await confirmAsync({
      message: 'Permanently delete the FCM Api Key from Expo servers?',
      initial: false,
    });
    if (!confirm) {
      return;
    }

    await ctx.newAndroid.deleteFcmAsync(fcm);
    Log.succeed('FCM Api Key removed');
  }
}
