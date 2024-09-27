import { AndroidAppBuildCredentialsMutation } from './graphql/mutations/AndroidAppBuildCredentialsMutation';
import { AndroidAppCredentialsMutation } from './graphql/mutations/AndroidAppCredentialsMutation';
import { AndroidFcmMutation } from './graphql/mutations/AndroidFcmMutation';
import { AndroidKeystoreMutation } from './graphql/mutations/AndroidKeystoreMutation';
import { GoogleServiceAccountKeyMutation } from './graphql/mutations/GoogleServiceAccountKeyMutation';
import { AndroidAppCredentialsQuery } from './graphql/queries/AndroidAppCredentialsQuery';
import { GoogleServiceAccountKeyQuery } from './graphql/queries/GoogleServiceAccountKeyQuery';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountFragment,
  AndroidAppBuildCredentialsFragment,
  AndroidFcmFragment,
  AndroidFcmVersion,
  AndroidKeystoreFragment,
  AppFragment,
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
} from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { GoogleServiceAccountKey, KeystoreWithType } from '../credentials';

export interface AppLookupParams {
  account: AccountFragment;
  projectName: string;
  androidApplicationIdentifier: string; // 'android.package' field in app.json
}

export async function getAndroidAppCredentialsWithCommonFieldsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<CommonAndroidAppCredentialsFragment | null> {
  const { androidApplicationIdentifier } = appLookupParams;
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
    graphqlClient,
    projectFullName,
    {
      androidApplicationIdentifier,
      legacyOnly: false,
    }
  );
}

export async function getAndroidAppBuildCredentialsListAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AndroidAppBuildCredentialsFragment[]> {
  const appCredentials = await getAndroidAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  return appCredentials?.androidAppBuildCredentialsList ?? [];
}

/* There is at most one set of legacy android app credentials associated with an Expo App */
export async function getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<CommonAndroidAppCredentialsFragment | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
    graphqlClient,
    projectFullName,
    {
      legacyOnly: true,
    }
  );
}

/* There is at most one set of legacy android app build credentials associated with an Expo App */
export async function getLegacyAndroidAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AndroidAppBuildCredentialsFragment | null> {
  const legacyAppCredentials = await getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  return legacyAppCredentials?.androidAppBuildCredentialsList[0] ?? null;
}

export async function createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<CommonAndroidAppCredentialsFragment> {
  const maybeAndroidAppCredentials = await getAndroidAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  if (maybeAndroidAppCredentials) {
    return maybeAndroidAppCredentials;
  } else {
    const app = await getAppAsync(graphqlClient, appLookupParams);
    return await AndroidAppCredentialsMutation.createAndroidAppCredentialsAsync(
      graphqlClient,
      {},
      app.id,
      appLookupParams.androidApplicationIdentifier
    );
  }
}

export async function updateAndroidAppCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appCredentials: CommonAndroidAppCredentialsFragment,
  {
    androidFcmId,
    googleServiceAccountKeyForSubmissionsId,
    googleServiceAccountKeyForFcmV1Id,
  }: {
    androidFcmId?: string;
    googleServiceAccountKeyForSubmissionsId?: string;
    googleServiceAccountKeyForFcmV1Id?: string;
  }
): Promise<CommonAndroidAppCredentialsFragment> {
  let updatedAppCredentials = appCredentials;
  if (androidFcmId) {
    updatedAppCredentials = await AndroidAppCredentialsMutation.setFcmKeyAsync(
      graphqlClient,
      appCredentials.id,
      androidFcmId
    );
  }
  if (googleServiceAccountKeyForSubmissionsId) {
    updatedAppCredentials =
      await AndroidAppCredentialsMutation.setGoogleServiceAccountKeyForSubmissionsAsync(
        graphqlClient,
        appCredentials.id,
        googleServiceAccountKeyForSubmissionsId
      );
  }
  if (googleServiceAccountKeyForFcmV1Id) {
    updatedAppCredentials =
      await AndroidAppCredentialsMutation.setGoogleServiceAccountKeyForFcmV1Async(
        graphqlClient,
        appCredentials.id,
        googleServiceAccountKeyForFcmV1Id
      );
  }
  return updatedAppCredentials;
}

export async function updateAndroidAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  buildCredentials: AndroidAppBuildCredentialsFragment,
  {
    androidKeystoreId,
  }: {
    androidKeystoreId: string;
  }
): Promise<AndroidAppBuildCredentialsFragment> {
  return await AndroidAppBuildCredentialsMutation.setKeystoreAsync(
    graphqlClient,
    buildCredentials.id,
    androidKeystoreId
  );
}

export async function setDefaultAndroidAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  buildCredentials: AndroidAppBuildCredentialsFragment
): Promise<AndroidAppBuildCredentialsFragment> {
  return await AndroidAppBuildCredentialsMutation.setDefaultAndroidAppBuildCredentialsAsync(
    graphqlClient,
    buildCredentials.id
  );
}

export async function createAndroidAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  {
    name,
    isDefault,
    androidKeystoreId,
  }: {
    name: string;
    isDefault: boolean;
    androidKeystoreId: string;
  }
): Promise<AndroidAppBuildCredentialsFragment> {
  const androidAppCredentials =
    await createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
      graphqlClient,
      appLookupParams
    );

  return await AndroidAppBuildCredentialsMutation.createAndroidAppBuildCredentialsAsync(
    graphqlClient,
    {
      name,
      isDefault,
      keystoreId: androidKeystoreId,
    },
    androidAppCredentials.id
  );
}

export async function getDefaultAndroidAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AndroidAppBuildCredentialsFragment | null> {
  const buildCredentialsList = await getAndroidAppBuildCredentialsListAsync(
    graphqlClient,
    appLookupParams
  );
  return buildCredentialsList.find(buildCredentials => buildCredentials.isDefault) ?? null;
}

export async function getAndroidAppBuildCredentialsByNameAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  name: string
): Promise<AndroidAppBuildCredentialsFragment | null> {
  const buildCredentialsList = await getAndroidAppBuildCredentialsListAsync(
    graphqlClient,
    appLookupParams
  );
  return buildCredentialsList.find(buildCredentials => buildCredentials.name === name) ?? null;
}

export async function createOrUpdateAndroidAppBuildCredentialsByNameAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  name: string,
  {
    androidKeystoreId,
  }: {
    androidKeystoreId: string;
  }
): Promise<AndroidAppBuildCredentialsFragment> {
  const existingBuildCredentialsWithName = await getAndroidAppBuildCredentialsByNameAsync(
    graphqlClient,
    appLookupParams,
    name
  );
  if (existingBuildCredentialsWithName) {
    return await updateAndroidAppBuildCredentialsAsync(
      graphqlClient,
      existingBuildCredentialsWithName,
      {
        androidKeystoreId,
      }
    );
  }
  const defaultBuildCredentialsExist = !!(await getDefaultAndroidAppBuildCredentialsAsync(
    graphqlClient,
    appLookupParams
  ));
  return await createAndroidAppBuildCredentialsAsync(graphqlClient, appLookupParams, {
    name,
    isDefault: !defaultBuildCredentialsExist, // make default if none exist
    androidKeystoreId,
  });
}

export async function createOrUpdateDefaultIosAppBuildCredentialsAsync(): Promise<void> {
  throw new Error('This requires user prompting. Look for me in BuildCredentialsUtils');
}

export async function createKeystoreAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  keystore: KeystoreWithType
): Promise<AndroidKeystoreFragment> {
  return await AndroidKeystoreMutation.createAndroidKeystoreAsync(
    graphqlClient,
    {
      base64EncodedKeystore: keystore.keystore,
      keystorePassword: keystore.keystorePassword,
      keyAlias: keystore.keyAlias,
      keyPassword: keystore.keyPassword,
    },
    account.id
  );
}

export async function deleteKeystoreAsync(
  graphqlClient: ExpoGraphqlClient,
  keystore: AndroidKeystoreFragment
): Promise<void> {
  await AndroidKeystoreMutation.deleteAndroidKeystoreAsync(graphqlClient, keystore.id);
}

export async function createFcmAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  fcmApiKey: string,
  version: AndroidFcmVersion
): Promise<AndroidFcmFragment> {
  return await AndroidFcmMutation.createAndroidFcmAsync(
    graphqlClient,
    { credential: fcmApiKey, version },
    account.id
  );
}

export async function deleteFcmAsync(
  graphqlClient: ExpoGraphqlClient,
  fcm: AndroidFcmFragment
): Promise<void> {
  await AndroidFcmMutation.deleteAndroidFcmAsync(graphqlClient, fcm.id);
}

export async function createGoogleServiceAccountKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  jsonKey: GoogleServiceAccountKey
): Promise<GoogleServiceAccountKeyFragment> {
  return await GoogleServiceAccountKeyMutation.createGoogleServiceAccountKeyAsync(
    graphqlClient,
    { jsonKey },
    account.id
  );
}

export async function deleteGoogleServiceAccountKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  googleServiceAccountKey: GoogleServiceAccountKeyFragment
): Promise<void> {
  await GoogleServiceAccountKeyMutation.deleteGoogleServiceAccountKeyAsync(
    graphqlClient,
    googleServiceAccountKey.id
  );
}

export async function getGoogleServiceAccountKeysForAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment
): Promise<GoogleServiceAccountKeyFragment[]> {
  return await GoogleServiceAccountKeyQuery.getAllForAccountAsync(graphqlClient, account.name);
}

async function getAppAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AppFragment> {
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AppQuery.byFullNameAsync(graphqlClient, projectFullName);
}

export const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
