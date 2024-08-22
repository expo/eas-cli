import { AndroidAppBuildCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { promptForNameAsync, sortBuildCredentials } from '../android/actions/BuildCredentialsUtils';
import { AppLookupParams } from '../android/api/GraphqlClient';
import { AndroidAppBuildCredentialsMetadataInput } from '../android/api/graphql/mutations/AndroidAppBuildCredentialsMutation';
import { CredentialsContext } from '../context';

export enum SelectAndroidBuildCredentialsResultType {
  CREATE_REQUEST,
  EXISTING_CREDENTIALS,
}
/**
 * Return a selected Android Build Credential, or a request to make a new one
 */
export class SelectAndroidBuildCredentials {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<
    | {
        resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST;
        result: AndroidAppBuildCredentialsMetadataInput;
      }
    | {
        resultType: SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS;
        result: AndroidAppBuildCredentialsFragment;
      }
  > {
    const buildCredentialsList = await ctx.android.getAndroidAppBuildCredentialsListAsync(
      ctx.graphqlClient,
      this.app
    );
    if (buildCredentialsList.length === 0) {
      return {
        resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
        result: {
          isDefault: true,
          name: await promptForNameAsync(),
        },
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
      | SelectAndroidBuildCredentialsResultType.CREATE_REQUEST = (
      await promptAsync({
        type: 'select',
        name: 'buildCredentialsResultOrRequestToCreateNew',
        message: 'Select build credentials',
        choices: [
          ...sortedBuildCredentialsChoices,
          {
            title: 'Create A New Build Credential Configuration',
            value: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
          },
        ],
      })
    ).buildCredentialsResultOrRequestToCreateNew;
    if (
      buildCredentialsResultOrRequestToCreateNew !==
      SelectAndroidBuildCredentialsResultType.CREATE_REQUEST
    ) {
      return {
        resultType: SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS,
        result: buildCredentialsResultOrRequestToCreateNew,
      };
    }

    const defaultCredentialsExists = buildCredentialsList.some(
      buildCredentials => buildCredentials.isDefault
    );
    return {
      resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      result: {
        isDefault: !defaultCredentialsExists, // make default if there isn't one
        name: await promptForNameAsync(),
      },
    };
  }
}

export class SelectExistingAndroidBuildCredentials {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<AndroidAppBuildCredentialsFragment | null> {
    const buildCredentialsList = await ctx.android.getAndroidAppBuildCredentialsListAsync(
      ctx.graphqlClient,
      this.app
    );
    if (buildCredentialsList.length === 0) {
      Log.log(`You don't have any Android Build Credentials`);
      return null;
    } else if (buildCredentialsList.length === 1) {
      return buildCredentialsList[0];
    }

    const sortedBuildCredentialsList = sortBuildCredentials(buildCredentialsList);
    const sortedBuildCredentialsChoices = sortedBuildCredentialsList.map(buildCredentials => ({
      title: buildCredentials.isDefault
        ? `${buildCredentials.name} (Default)`
        : buildCredentials.name,
      value: buildCredentials,
    }));

    return (
      await promptAsync({
        type: 'select',
        name: 'buildCredentials',
        message: 'Select build credentials',
        choices: sortedBuildCredentialsChoices,
      })
    ).buildCredentials;
  }
}
