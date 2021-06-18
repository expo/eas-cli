import chalk from 'chalk';

import Log, { learnMore } from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { Context } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { PushKey, PushKeyStoreInfo } from '../appstore/Credentials.types';
import { APPLE_KEYS_TOO_MANY_GENERATED_ERROR } from '../appstore/pushKey';
import { pushKeySchema } from '../credentials';
import { validatePushKeyAsync } from '../validators/validatePushKey';

export async function provideOrGeneratePushKeyAsync(
  ctx: Context,
  accountName: string
): Promise<PushKey> {
  if (!ctx.nonInteractive) {
    const userProvided = await promptForPushKeyAsync(ctx);
    if (userProvided) {
      if (!ctx.appStore.authCtx) {
        Log.warn('Unable to validate push key due to insufficient Apple Credentials');
        return userProvided;
      } else {
        const isValid = await validatePushKeyAsync(ctx, userProvided);
        if (isValid) {
          return userProvided;
        }
        // user could've just input the id wrong, and the p8 could still be valid
        const useUserProvided = await confirmAsync({
          message: `Push Key with ID ${userProvided.apnsKeyId} could not be found on Apple's servers. Proceed anyway?`,
        });
        if (useUserProvided) {
          return userProvided;
        }
        return await provideOrGeneratePushKeyAsync(ctx, accountName);
      }
    }
  }
  return await generatePushKeyAsync(ctx, accountName);
}

async function promptForPushKeyAsync(ctx: Context): Promise<PushKey | null> {
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

async function generatePushKeyAsync(ctx: Context, accountName: string): Promise<PushKey> {
  await ctx.appStore.ensureAuthenticatedAsync();
  try {
    return await ctx.appStore.createPushKeyAsync();
  } catch (e) {
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
      Log.log(learnMore('https://docs.expo.io/distribution/app-signing/#push-notification-keys'));
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
  return await generatePushKeyAsync(ctx, accountName);
}

function formatPushKeyFromApple(pushKey: PushKeyStoreInfo): string {
  const { name, id } = pushKey;
  const keyIdText = id ? ` - Key ID: ${id}` : ``;
  return `${name}${keyIdText}`;
}
