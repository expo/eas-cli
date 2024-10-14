import assert from 'assert';
import { nanoid } from 'nanoid';

import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import { ora } from '../../../ora';
import { getApplicationIdAsync } from '../../../project/android/applicationId';
import { GradleBuildContext } from '../../../project/android/gradle';
import {
  getOwnerAccountForProjectIdAsync,
  getProjectConfigDescription,
} from '../../../project/projectUtils';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AndroidPackageNotDefinedError } from '../../errors';
import { AppLookupParams } from '../api/GraphqlClient';

/**
 * Legacy credentials can be copied over to EAS if the user does not have
 * EAS credentials set up yet
 */
export async function canCopyLegacyCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams
): Promise<boolean> {
  const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
    ctx.graphqlClient,
    app
  );
  if (appCredentials) {
    return false; // modern credentials already exist
  }

  const legacyAppCredentials =
    await ctx.android.getLegacyAndroidAppCredentialsWithCommonFieldsAsync(ctx.graphqlClient, app);
  return !!legacyAppCredentials; // user has some legacy credentials
}

export async function promptUserAndCopyLegacyCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams
): Promise<void> {
  assert(
    await canCopyLegacyCredentialsAsync(ctx, app),
    'User not eligible to copy classic build credentials to EAS'
  );

  const spinner = ora('Classic credentials detected, copying to EAS...').start();

  try {
    const legacyAppCredentials =
      await ctx.android.getLegacyAndroidAppCredentialsWithCommonFieldsAsync(ctx.graphqlClient, app);
    if (!legacyAppCredentials) {
      return;
    }

    const appCredentials =
      await ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
        ctx.graphqlClient,
        app
      );
    const legacyFcm = legacyAppCredentials.androidFcm;
    if (legacyFcm) {
      const clonedFcm = await ctx.android.createFcmAsync(
        ctx.graphqlClient,
        app.account,
        legacyFcm.credential,
        legacyFcm.version
      );
      await ctx.android.updateAndroidAppCredentialsAsync(ctx.graphqlClient, appCredentials, {
        androidFcmId: clonedFcm.id,
      });
    }

    const legacyBuildCredentials = await ctx.android.getLegacyAndroidAppBuildCredentialsAsync(
      ctx.graphqlClient,
      app
    );
    const legacyKeystore = legacyBuildCredentials?.androidKeystore ?? null;

    if (legacyKeystore) {
      const clonedKeystore = await ctx.android.createKeystoreAsync(ctx.graphqlClient, app.account, {
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
  } catch (e) {
    spinner.fail(`Unable to migrate credentials to EAS.`);
    throw e;
  }

  spinner.succeed('Credentials copied to EAS.');
}

export async function getAppLookupParamsFromContextAsync(
  ctx: CredentialsContext,
  gradleContext?: GradleBuildContext
): Promise<AppLookupParams> {
  const exp = await ctx.getExpoConfigAsync();
  const projectName = exp.slug;
  const projectId = await ctx.getProjectIdAsync();
  const account = await getOwnerAccountForProjectIdAsync(ctx.graphqlClient, projectId);

  const androidApplicationIdentifier = await getApplicationIdAsync(
    ctx.projectDir,
    exp,
    ctx.vcsClient,
    gradleContext
  );
  if (!androidApplicationIdentifier) {
    throw new AndroidPackageNotDefinedError(
      `android.package needs to be defined in your ${getProjectConfigDescription(
        ctx.projectDir
      )} file`
    );
  }

  return { account, projectName, androidApplicationIdentifier };
}

export async function createOrUpdateDefaultAndroidAppBuildCredentialsAsync(
  ctx: CredentialsContext,
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
  const existingDefaultBuildCredentials =
    await ctx.android.getDefaultAndroidAppBuildCredentialsAsync(ctx.graphqlClient, appLookupParams);
  if (existingDefaultBuildCredentials) {
    return await ctx.android.updateAndroidAppBuildCredentialsAsync(
      ctx.graphqlClient,
      existingDefaultBuildCredentials,
      { androidKeystoreId }
    );
  }
  return await ctx.android.createAndroidAppBuildCredentialsAsync(
    ctx.graphqlClient,
    appLookupParams,
    {
      name: generateRandomName(),
      isDefault: true,
      androidKeystoreId,
    }
  );
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
