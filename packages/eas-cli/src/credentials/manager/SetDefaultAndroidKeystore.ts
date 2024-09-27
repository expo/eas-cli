import { AndroidAppBuildCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { sortBuildCredentials } from '../android/actions/BuildCredentialsUtils';
import { AppLookupParams } from '../android/api/GraphqlClient';
import { CredentialsContext } from '../context';

export class SetDefaultAndroidKeystore {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<AndroidAppBuildCredentialsFragment | undefined> {
    const buildCredentialsList = await ctx.android.getAndroidAppBuildCredentialsListAsync(
      ctx.graphqlClient,
      this.app
    );
    if (buildCredentialsList.length === 0) {
      Log.log(`You don't have any Android build credentials`);
      return;
    }
    const sortedBuildCredentialsList = sortBuildCredentials(buildCredentialsList);
    const sortedBuildCredentialsChoices = sortedBuildCredentialsList.map(buildCredentials => ({
      title: buildCredentials.isDefault
        ? `${buildCredentials.name} (Default)`
        : buildCredentials.name,
      value: buildCredentials,
    }));

    const { buildCredentialsResult } = await promptAsync({
      type: 'select',
      name: 'buildCredentialsResult',
      message: 'Select build credentials',
      choices: [...sortedBuildCredentialsChoices, { title: 'Cancel', value: null }],
    });

    if (!buildCredentialsResult?.androidKeystore) {
      return;
    }

    Log.log('Updating the default build credentials for this project...');
    return await ctx.android.setDefaultAndroidAppBuildCredentialsAsync(ctx.graphqlClient, {
      ...buildCredentialsResult,
      isDefault: true,
    });
  }
}
