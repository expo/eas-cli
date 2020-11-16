import { Keys } from '@expo/apple-utils';
import chalk from 'chalk';
import dateformat from 'dateformat';
import ora from 'ora';

import log from '../../../log';
import { PushKey, PushKeyStoreInfo } from './Credentials.types';
import { AuthCtx } from './authenticate';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

const { MaxKeysCreatedError } = Keys;

const APPLE_KEYS_TOO_MANY_GENERATED_ERROR = `
You can have only ${chalk.underline('two')} Apple Keys generated on your Apple Developer account.
Please revoke the old ones or reuse existing from your other apps.
Please remember that Apple Keys are not application specific!
`;

export async function listPushKeysAsync(ctx: AuthCtx): Promise<PushKeyStoreInfo[]> {
  const spinner = ora(`Getting Push Keys from Apple...`).start();
  try {
    if (USE_APPLE_UTILS) {
      const keys = await Keys.getKeysAsync();
      spinner.succeed();
      return keys;
    } else {
      const args = ['list', ctx.appleId, ctx.appleIdPassword, ctx.team.id];
      const { keys } = await runActionAsync(travelingFastlane.managePushKeys, args);
      spinner.succeed();
      return keys;
    }
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export async function createPushKeyAsync(
  ctx: AuthCtx,
  name: string = `Expo Push Notifications Key ${dateformat('yyyymmddHHMMss')}`
): Promise<PushKey> {
  const spinner = ora(`Creating Push Key on Apple Servers...`).start();
  try {
    if (USE_APPLE_UTILS) {
      const key = await Keys.createKeyAsync({ name, isApns: true });
      const apnsKeyP8 = await Keys.downloadKeyAsync({ id: key.id });
      spinner.succeed();
      return {
        apnsKeyId: key.id,
        apnsKeyP8,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      };
    } else {
      const args = ['create', ctx.appleId, ctx.appleIdPassword, ctx.team.id, name];
      const { apnsKeyId, apnsKeyP8 } = await runActionAsync(travelingFastlane.managePushKeys, args);
      spinner.succeed();
      return {
        apnsKeyId,
        apnsKeyP8,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      };
    }
  } catch (err) {
    spinner.fail('Failed to create Push Notifications Key');
    const resultString = err.rawDump?.resultString;
    if (
      err instanceof MaxKeysCreatedError ||
      (resultString && resultString.match(/maximum allowed number of Keys/))
    ) {
      throw new Error(APPLE_KEYS_TOO_MANY_GENERATED_ERROR);
    }
    throw err;
  }
}

export async function revokePushKeyAsync(ctx: AuthCtx, ids: string[]): Promise<void> {
  const spinner = ora(`Revoking Push Key on Apple Servers...`).start();
  try {
    if (USE_APPLE_UTILS) {
      await Promise.all(ids.map(id => Keys.revokeKeyAsync({ id })));
    } else {
      const args = ['revoke', ctx.appleId, ctx.appleIdPassword, ctx.team.id, ids.join(',')];
      await runActionAsync(travelingFastlane.managePushKeys, args);
    }
    spinner.succeed();
  } catch (error) {
    log.error(error);
    spinner.fail('Failed to revoke Push Key on Apple Servers');
    throw error;
  }
}
