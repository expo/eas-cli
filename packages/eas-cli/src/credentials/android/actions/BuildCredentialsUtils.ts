import assert from 'assert';
import { nanoid } from 'nanoid';
import ora from 'ora';

import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { getApplicationId } from '../../../project/android/applicationId';
import { getProjectAccountName, getProjectConfigDescription } from '../../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../../prompts';
import { findAccountByName } from '../../../user/Account';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

/**
 * Legacy credentials can be copied over to EAS if the user does not have
 * EAS credentials set up yet
 */
export async function canCopyLegacyCredentialsAsync(
  ctx: Context,
  app: AppLookupParams
): Promise<boolean> {
  const appCredentials = await ctx.newAndroid.getAndroidAppCredentialsWithCommonFieldsAsync(app);
  if (appCredentials) {
    return false; // modern credentials already exist
  }

  const legacyAppCredentials = await ctx.newAndroid.getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
    app
  );
  return !!legacyAppCredentials; // user has some legacy credentials
}

export async function promptUserAndCopyLegacyCredentialsAsync(
  ctx: Context,
  app: AppLookupParams
): Promise<void> {
  assert(
    !ctx.nonInteractive,
    'Copying over Expo Classic credentials cannot be run in non-interactive mode'
  );
  const shouldCopy = await confirmAsync({
    message: `We've detected credentials from Expo Classic (expo-cli). Would you like to copy them over to Expo Application Services (EAS)?`,
  });
  if (!shouldCopy) {
    return;
  }
  assert(
    await canCopyLegacyCredentialsAsync(ctx, app),
    'User not eligible to copy Expo Classic credentials to EAS'
  );

  Log.log('Copying credentials...');
  const spinner = ora().start();

  const legacyAppCredentials = await ctx.newAndroid.getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
    app
  );
  if (!legacyAppCredentials) {
    return;
  }

  const appCredentials = await ctx.newAndroid.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
    app
  );
  const legacyFcm = legacyAppCredentials.androidFcm;
  if (legacyFcm) {
    const clonedFcm = await ctx.newAndroid.createFcmAsync(
      app.account,
      legacyFcm.credential,
      legacyFcm.version
    );
    await ctx.newAndroid.updateAndroidAppCredentialsAsync(appCredentials, {
      androidFcmId: clonedFcm.id,
    });
  }

  const legacyBuildCredentials = await ctx.newAndroid.getLegacyAndroidAppBuildCredentialsAsync(app);
  const legacyKeystore = legacyBuildCredentials?.androidKeystore ?? null;

  if (legacyKeystore) {
    const clonedKeystore = await ctx.newAndroid.createKeystoreAsync(app.account, {
      keystore: legacyKeystore.keystore,
      keystorePassword: legacyKeystore.keystorePassword,
      keyAlias: legacyKeystore.keyAlias,
      keyPassword: legacyKeystore.keyPassword ?? undefined,
      type: legacyKeystore.type,
    });
    await createOrUpdateDefaultAndroidAppBuildCredentialsAsync(ctx, app, {
      androidKeystoreId: clonedKeystore.id,
    });
  }
  spinner.succeed('Credentials successfully copied');
}

export function getAppLookupParamsFromContext(ctx: Context): AppLookupParams {
  ctx.ensureProjectContext();
  const projectName = ctx.exp.slug;
  const accountName = getProjectAccountName(ctx.exp, ctx.user);
  const account = findAccountByName(ctx.user.accounts, accountName);
  if (!account) {
    throw new Error(`You do not have access to account: ${accountName}`);
  }

  const androidApplicationIdentifier = getApplicationId(ctx.projectDir, ctx.exp);
  if (!androidApplicationIdentifier) {
    throw new Error(
      `android.package needs to be defined in your ${getProjectConfigDescription(
        ctx.projectDir
      )} file`
    );
  }

  return { account, projectName, androidApplicationIdentifier };
}

export async function createOrUpdateDefaultAndroidAppBuildCredentialsAsync(
  ctx: Context,
  appLookupParams: AppLookupParams,
  {
    androidKeystoreId,
  }: {
    androidKeystoreId: string;
  }
): Promise<AndroidAppBuildCredentialsFragment> {
  assert(
    !ctx.nonInteractive,
    'createOrUpdateDefaultAndroidAppBuildCredentialsAsync must be run in interactive mode'
  );
  const existingDefaultBuildCredentials = await ctx.newAndroid.getDefaultAndroidAppBuildCredentialsAsync(
    appLookupParams
  );
  if (existingDefaultBuildCredentials) {
    return await ctx.newAndroid.updateAndroidAppBuildCredentialsAsync(
      existingDefaultBuildCredentials,
      { androidKeystoreId }
    );
  }
  const providedName = await promptForNameAsync();
  return await ctx.newAndroid.createAndroidAppBuildCredentialsAsync(appLookupParams, {
    name: providedName,
    isDefault: true,
    androidKeystoreId,
  });
}

export async function promptForNameAsync(): Promise<string> {
  const { providedName } = await promptAsync({
    type: 'text',
    name: 'providedName',
    message: 'Assign a name to your build credentials:',
    initial: generateRandomName(),
    validate: (input: string) => input !== '',
  });
  return providedName;
}

/**
 * sort a build credentials array in descending order of preference
 * prefer default credentials, then prefer names that come first lexicographically
 */
export function sortBuildCredentials(
  androidAppBuildCredentialsList: AndroidAppBuildCredentialsFragment[]
): AndroidAppBuildCredentialsFragment[] {
  return androidAppBuildCredentialsList.sort((buildCredentialsA, buildCredentialsB) => {
    if (buildCredentialsA.isDefault) {
      return -1;
    } else if (buildCredentialsB.isDefault) {
      return 1;
    }
    return buildCredentialsA.name.localeCompare(buildCredentialsB.name);
  });
}

function generateRandomName(): string {
  return `Build Credentials ${nanoid(10)}`;
}
