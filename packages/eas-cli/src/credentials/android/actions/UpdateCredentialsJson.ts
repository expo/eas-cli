import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateAndroidCredentialsAsync } from '../../credentialsJson/update';
import { AndroidAppCredentialsQuery } from '../api/graphql/queries/AndroidAppCredentialsQuery';

export class UpdateCredentialsJson implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const legacyAppCredentials = await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
      this.projectFullName,
      {
        legacyOnly: true,
      }
    );
    const legacyBuildCredentials = legacyAppCredentials?.androidAppBuildCredentialsList[0] ?? null;
    if (!legacyBuildCredentials) {
      Log.log('You dont have any Expo Classic Android credentials configured at this time');
      return;
    }
    Log.log('Updating Android credentials in credentials.json');

    await updateAndroidCredentialsAsync(ctx, legacyBuildCredentials);
    Log.succeed(
      'Android part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
