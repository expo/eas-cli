import { AndroidAppBuildCredentialsFragment } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { promptForNameAsync } from '../android/actions/BuildCredentialsUtils';
import { AppLookupParams } from '../android/api/GraphqlClient';
import { AndroidAppBuildCredentialsMetadataInput } from '../android/api/graphql/mutations/AndroidAppBuildCredentialsMutation';
import { sortBuildCredentials } from '../android/utils/printCredentialsBeta';
import { Context } from '../context';

export const CREATE_NEW_BUILD_CREDENTIALS = 'CREATE_NEW_BUILD_CREDENTIALS';
/**
 * Return a selected Android Build Credential, or a request to make a new one
 */
export class SelectAndroidBuildCredentials {
  constructor(private app: AppLookupParams) {}

  async runAsync(
    ctx: Context
  ): Promise<AndroidAppBuildCredentialsFragment | AndroidAppBuildCredentialsMetadataInput> {
    await ctx.newAndroid.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
      this.app
    );
    const buildCredentialsList = await ctx.newAndroid.getAndroidAppBuildCredentialsListAsync(
      this.app
    );
    if (buildCredentialsList.length === 0) {
      return {
        isDefault: true,
        name: await promptForNameAsync(),
      };
    }
    const sortedBuildCredentialsList = sortBuildCredentials(buildCredentialsList);
    const sortedBuildCredentialsChoices = sortedBuildCredentialsList.map(buildCredentials => ({
      title: buildCredentials.isDefault
        ? `${buildCredentials.name} (Default)`
        : buildCredentials.name,
      value: buildCredentials,
    }));

    const buildCredentialsResultOrRequestToCreateNew:
      | AndroidAppBuildCredentialsFragment
      | 'CREATE_NEW_BUILD_CREDENTIALS' = (
      await promptAsync({
        type: 'select',
        name: 'buildCredentialsResultOrRequestToCreateNew',
        message: 'Select build credentials',
        choices: [
          ...sortedBuildCredentialsChoices,
          {
            title: 'Create A New Build Credential Configuration',
            value: CREATE_NEW_BUILD_CREDENTIALS,
          },
        ],
      })
    ).buildCredentialsResultOrRequestToCreateNew;
    if (buildCredentialsResultOrRequestToCreateNew !== CREATE_NEW_BUILD_CREDENTIALS) {
      return buildCredentialsResultOrRequestToCreateNew;
    }

    const defaultCredentialsExists = buildCredentialsList.some(
      buildCredentials => buildCredentials.isDefault
    );
    return {
      isDefault: !defaultCredentialsExists, // make default if there isn't one
      name: await promptForNameAsync(),
    };
  }
}
