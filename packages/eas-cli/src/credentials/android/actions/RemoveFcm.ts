import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams, formatProjectFullName } from '../api/GraphqlClient';

export class RemoveFcm {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(
        "Deleting an FCM API Key is a destructive operation. Start the CLI without the '--non-interactive' flag to delete the credentials."
      );
    }
    const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app
    );
    const fcm = appCredentials?.androidFcm;
    if (!fcm) {
      Log.warn(
        `There is no valid FCM API Key defined for ${formatProjectFullName(this.app)}, ${
          this.app.androidApplicationIdentifier
        }`
      );
      return;
    }

    const confirm = await confirmAsync({
      message: 'Permanently delete the FCM API Key from Expo servers?',
      initial: false,
    });
    if (!confirm) {
      return;
    }

    await ctx.android.deleteFcmAsync(ctx.graphqlClient, fcm);
    Log.succeed('FCM API Key removed');
  }
}
