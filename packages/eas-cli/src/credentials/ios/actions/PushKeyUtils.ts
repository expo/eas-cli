import chalk from 'chalk';

import { formatAppleTeam } from './AppleTeamFormatting';
import { AccountFragment, ApplePushKeyFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
import { CredentialsContext } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { PushKey, PushKeyStoreInfo } from '../appstore/Credentials.types';
import { filterRevokedAndUntrackedPushKeysFromEasServersAsync } from '../appstore/CredentialsUtils';
import { APPLE_KEYS_TOO_MANY_GENERATED_ERROR } from '../appstore/pushKey';
import { pushKeySchema } from '../credentials';
import { isPushKeyValidAndTrackedAsync } from '../validators/validatePushKey';

export async function provideOrGeneratePushKeyAsync(ctx: CredentialsContext): Promise<PushKey> {
  if (!ctx.nonInteractive) {
    const userProvided = await promptForPushKeyAsync(ctx);
    if (userProvided) {
      if (!ctx.appStore.authCtx) {
        Log.warn('Unable to validate push key, you are not authenticated with Apple.');
        return userProvided;
      } else {
        const isValidAndTracked = await isPushKeyValidAndTrackedAsync(ctx, userProvided);
        if (isValidAndTracked) {
          return userProvided;
        }
        // user could've just input the id wrong, and the p8 could still be valid
        const useUserProvided = await confirmAsync({
          message: `Push Key with ID ${userProvided.apnsKeyId} could not be found on Apple's servers. Proceed anyway?`,
        });
        if (useUserProvided) {
          return userProvided;
        }
        return await provideOrGeneratePushKeyAsync(ctx);
      }
    }
  }
  return await generatePushKeyAsync(ctx);
}

async function promptForPushKeyAsync(ctx: CredentialsContext): Promise<PushKey | null> {
  let initialValues: { teamId?: string } = {};
  if (ctx.appStore.authCtx) {
    initialValues = {
      teamId: ctx.appStore.authCtx.team.id,
    };
  }
  const userProvided = await askForUserProvidedAsync(pushKeySchema, initialValues);
  if (!userProvided) {
    return null;
  }
  if (ctx.appStore.authCtx && userProvided.teamId === initialValues.teamId) {
    return {
      ...userProvided,
      teamName: ctx.appStore.authCtx.team.name,
    };
  }
  return userProvided;
}

async function generatePushKeyAsync(ctx: CredentialsContext): Promise<PushKey> {
  await ctx.appStore.ensureAuthenticatedAsync();
  try {
    return await ctx.appStore.createPushKeyAsync();
  } catch (e: any) {
    if (e.message === APPLE_KEYS_TOO_MANY_GENERATED_ERROR) {
      const pushKeys = await ctx.appStore.listPushKeysAsync();
      Log.warn('Maximum number of Push Notifications Keys generated on Apple Developer Portal.');
      Log.warn(APPLE_KEYS_TOO_MANY_GENERATED_ERROR);

      if (ctx.nonInteractive) {
        throw new Error(
          "Start the CLI without the '--non-interactive' flag to revoke existing push notification keys."
        );
      }

      Log.log(chalk.grey(`⚠️  Revoking a Push Key will affect other apps that rely on it`));
      Log.log(learnMore('https://docs.expo.dev/distribution/app-signing/#push-notification-keys'));
      Log.log();

      const { pushKeysToRevoke } = await promptAsync({
        type: 'multiselect',
        name: 'pushKeysToRevoke',
        message: 'Select Push Notifications Key to revoke.',
        // @ts-expect-error property missing from `@types/prompts`
        optionsPerPage: 20,
        choices: pushKeys.map(pushKey => ({
          value: pushKey,
          title: formatPushKeyFromApple(pushKey),
        })),
      });

      if (pushKeysToRevoke.length > 0) {
        const ids = pushKeysToRevoke.map(({ id }: PushKeyStoreInfo) => id);
        await ctx.appStore.revokePushKeyAsync(ids);
      }
    } else {
      throw e;
    }
  }
  return await generatePushKeyAsync(ctx);
}

function formatPushKeyFromApple(pushKey: PushKeyStoreInfo): string {
  const { name, id } = pushKey;
  const keyIdText = id ? ` - Key ID: ${id}` : ``;
  return `${name}${keyIdText}`;
}

/**
 * select a push key from an account (validity status shown on a best effort basis)
 * */
export async function selectPushKeyAsync(
  ctx: CredentialsContext,
  account: AccountFragment
): Promise<ApplePushKeyFragment | null> {
  const pushKeysForAccount = await ctx.ios.getPushKeysForAccountAsync(ctx.graphqlClient, account);
  if (pushKeysForAccount.length === 0) {
    Log.warn(`There are no Push Keys available in your EAS account.`);
    return null;
  }
  if (!ctx.appStore.authCtx) {
    return await selectPushKeysAsync(pushKeysForAccount);
  }

  const validPushKeys = await getValidAndTrackedPushKeysOnEasServersAsync(ctx, pushKeysForAccount);
  return await selectPushKeysAsync(pushKeysForAccount, validPushKeys);
}

export async function getValidAndTrackedPushKeysOnEasServersAsync(
  ctx: CredentialsContext,
  pushKeysForAccount: ApplePushKeyFragment[]
): Promise<ApplePushKeyFragment[]> {
  const pushInfoFromApple = await ctx.appStore.listPushKeysAsync();
  return await filterRevokedAndUntrackedPushKeysFromEasServersAsync(
    pushKeysForAccount,
    pushInfoFromApple
  );
}

async function selectPushKeysAsync(
  pushKeys: ApplePushKeyFragment[],
  validPushKeys?: ApplePushKeyFragment[]
): Promise<ApplePushKeyFragment | null> {
  const validPushKeyIdentifiers = validPushKeys?.map(pushKey => pushKey.keyIdentifier);
  const sortedPushKeys = sortPushKeys(pushKeys, validPushKeys);
  const { chosenPushKey } = await promptAsync({
    type: 'select',
    name: 'chosenPushKey',
    message: 'Select a push key from the list.',
    choices: sortedPushKeys.map(pushKey => ({
      title: formatPushKey(pushKey, validPushKeyIdentifiers),
      value: pushKey,
    })),
  });
  return chosenPushKey;
}

export function sortPushKeys(
  pushKeys: ApplePushKeyFragment[],
  validPushKeys?: ApplePushKeyFragment[]
): ApplePushKeyFragment[] {
  const validPushKeyIdentifiers = validPushKeys?.map(pushKey => pushKey.keyIdentifier);
  return pushKeys.sort((pushKeyA, pushKeyB) => {
    if (validPushKeyIdentifiers?.includes(pushKeyA.keyIdentifier)) {
      return -1;
    } else if (validPushKeyIdentifiers?.includes(pushKeyB.keyIdentifier)) {
      return 1;
    }
    return 0;
  });
}

export function formatPushKey(
  pushKey: ApplePushKeyFragment,
  validPushKeyIdentifiers?: string[]
): string {
  const { keyIdentifier, appleTeam, updatedAt } = pushKey;
  let line: string = '';

  line += `Push Key ID: ${pushKey.keyIdentifier}`;
  line += ` ${appleTeam ? `, ${formatAppleTeam(appleTeam)}` : ''}`;
  line += chalk.gray(`\n    Updated: ${fromNow(new Date(updatedAt))} ago,`);

  const apps = pushKey.iosAppCredentialsList.map(appCredentials => appCredentials.app);
  if (apps.length) {
    // iosAppCredentialsList is capped at 20 on www
    const appFullNames = apps
      .map(app => app.fullName)
      .slice(0, 19)
      .join(',');
    const andMaybeMore = apps.length > 19 ? ' (and more)' : '';
    line += chalk.gray(`\n    📲 Used by: ${appFullNames}${andMaybeMore}`);
  }

  if (validPushKeyIdentifiers?.includes(keyIdentifier)) {
    line += chalk.gray("\n    ✅ Currently valid on Apple's servers.");
  } else {
    line += '';
  }
  return line;
}
