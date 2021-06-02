import assert from 'assert';
import { nanoid } from 'nanoid';

import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import { getApplicationId } from '../../../project/android/applicationId';
import { getProjectAccountName, getProjectConfigDescription } from '../../../project/projectUtils';
import { promptAsync } from '../../../prompts';
import { findAccountByName } from '../../../user/Account';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

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

function generateRandomName(): string {
  return `Build Credentials ${nanoid(10)}`;
}
