import { Keys } from '@expo/apple-utils';
import chalk from 'chalk';
import dateformat from 'dateformat';
import ora from 'ora';

import log from '../../../log';
import { PushKey, PushKeyStoreInfo } from './Credentials.types';
import { AuthCtx, getRequestContext } from './authenticate';

const { MaxKeysCreatedError } = Keys;

const APPLE_KEYS_TOO_MANY_GENERATED_ERROR = `
You can have only ${chalk.underline('two')} Apple Keys generated on your Apple Developer account.
Please revoke the old ones or reuse existing from your other apps.
Please remember that Apple Keys are not application specific!
`;

export async function listPushKeysAsync(authCtx: AuthCtx): Promise<PushKeyStoreInfo[]> {
  const spinner = ora(`Fetching Push Keys from Apple`).start();
  try {
    const context = getRequestContext(authCtx);
    const keys = await Keys.getKeysAsync(context);
    spinner.succeed(`Fetched Push Keys from Apple`);
    return keys;
  } catch (error) {
    spinner.fail(`Failed to fetch Push Keys from Apple`);
    throw error;
  }
}

export async function createPushKeyAsync(
  authCtx: AuthCtx,
  name: string = `Expo Push Notifications Key ${dateformat('yyyymmddHHMMss')}`
): Promise<PushKey> {
  const spinner = ora(`Creating Push Key on Apple`).start();
  try {
    const context = getRequestContext(authCtx);
    const key = await Keys.createKeyAsync(context, { name, isApns: true });
    const apnsKeyP8 = await Keys.downloadKeyAsync(context, { id: key.id });
    spinner.succeed(`Created Push Key on Apple`);
    return {
      apnsKeyId: key.id,
      apnsKeyP8,
      teamId: authCtx.team.id,
      teamName: authCtx.team.name,
    };
  } catch (err) {
    spinner.fail('Failed to create Push Key on Apple');
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

export async function revokePushKeyAsync(authCtx: AuthCtx, ids: string[]): Promise<void> {
  const spinner = ora(`Revoking Push Key on Apple`).start();
  try {
    const context = getRequestContext(authCtx);
    await Promise.all(ids.map(id => Keys.revokeKeyAsync(context, { id })));

    spinner.succeed(`Revoked Push Key on Apple`);
  } catch (error) {
    log.error(error);
    spinner.fail('Failed to revoke Push Key on Apple');
    throw error;
  }
}
