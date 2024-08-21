import { AndroidAppBuildCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { promptForNameAsync } from '../android/actions/BuildCredentialsUtils';
import { CreateKeystore } from '../android/actions/CreateKeystore';
import { AppLookupParams } from '../android/api/GraphqlClient';
import { CredentialsContext } from '../context';

export class CreateAndroidBuildCredentials {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<AndroidAppBuildCredentialsFragment> {
    const name = await promptForNameAsync();

    const buildCredentialsList = await ctx.android.getAndroidAppBuildCredentialsListAsync(
      ctx.graphqlClient,
      this.app
    );

    let isDefault = true;
    if (buildCredentialsList.length > 0) {
      isDefault = await confirmAsync({
        message: 'Do you want to set this as your default build credentials?',
        initial: false,
      });
    }

    const keystore = await new CreateKeystore(this.app.account).runAsync(ctx);
    const createAndroidCredentials = await ctx.android.createAndroidAppBuildCredentialsAsync(
      ctx.graphqlClient,
      this.app,
      {
        name,
        isDefault,
        androidKeystoreId: keystore.id,
      }
    );

    Log.succeed(`Created Android build credentials ${createAndroidCredentials.name}`);
    return createAndroidCredentials;
  }
}
