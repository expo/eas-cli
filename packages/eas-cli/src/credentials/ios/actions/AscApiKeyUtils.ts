import chalk from 'chalk';
import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { formatAppleTeam } from './AppleTeamFormatting';
import { AccountFragment, AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
import { CredentialsContext } from '../../context';
import {
  getCredentialsFromUserAsync,
  shouldAutoGenerateCredentialsAsync,
} from '../../utils/promptForCredentials';
import { AscApiKey } from '../appstore/Credentials.types';
import {
  AscApiKeyPath,
  MinimalAscApiKey,
  ascApiKeyIdSchema,
  ascApiKeyIssuerIdSchema,
} from '../credentials';
import { isAscApiKeyValidAndTrackedAsync } from '../validators/validateAscApiKey';

export enum AppStoreApiKeyPurpose {
  SUBMISSION_SERVICE = 'EAS Submit',
}

export async function promptForAscApiKeyPathAsync(ctx: CredentialsContext): Promise<AscApiKeyPath> {
  const { keyId, keyP8Path } = await promptForKeyP8AndIdAsync();

  const bestEffortIssuerId = await getBestEffortIssuerIdAsync(ctx, keyId);
  if (bestEffortIssuerId) {
    Log.log(`Detected Issuer ID: ${bestEffortIssuerId}`);
    return { keyId, issuerId: bestEffortIssuerId, keyP8Path };
  }
  const issuerId = await promptForIssuerIdAsync();
  return { keyId, issuerId, keyP8Path };
}

export async function promptForIssuerIdAsync(): Promise<string> {
  Log.log(chalk.bold('An App Store Connect Issuer ID is required'));
  Log.log(
    `If you're not sure what this is or how to find yours, ${learnMore(
      'https://expo.fyi/asc-issuer-id'
    )}`
  );

  // Do not perform uuid validation - Apple's issuerIds are not RFC4122 compliant
  const { issuerId } = await getCredentialsFromUserAsync(ascApiKeyIssuerIdSchema);
  return issuerId;
}

export async function getMinimalAscApiKeyAsync(ascApiKey: AscApiKey): Promise<MinimalAscApiKey> {
  return {
    ...ascApiKey,
    issuerId: ascApiKey.issuerId ?? (await promptForIssuerIdAsync()),
  };
}

export async function provideOrGenerateAscApiKeyAsync(
  ctx: CredentialsContext,
  purpose: AppStoreApiKeyPurpose
): Promise<MinimalAscApiKey> {
  if (ctx.nonInteractive) {
    throw new Error(`A new App Store Connect API Key cannot be created in non-interactive mode.`);
  }

  const userProvided = await promptForAscApiKeyAsync(ctx);
  if (!userProvided) {
    return await generateAscApiKeyAsync(ctx, purpose);
  }

  if (!ctx.appStore.authCtx) {
    Log.warn('Unable to validate App Store Connect API Key, you are not authenticated with Apple.');
    return userProvided;
  }

  const isValidAndTracked = await isAscApiKeyValidAndTrackedAsync(ctx, userProvided);
  if (isValidAndTracked) {
    return userProvided;
  }
  const useUserProvided = await confirmAsync({
    message: `App Store Connect API Key with ID ${userProvided.keyId} is not valid on Apple's servers. Proceed anyway?`,
  });
  if (useUserProvided) {
    return userProvided;
  }
  return await provideOrGenerateAscApiKeyAsync(ctx, purpose);
}

async function generateAscApiKeyAsync(
  ctx: CredentialsContext,
  purpose: AppStoreApiKeyPurpose
): Promise<MinimalAscApiKey> {
  await ctx.appStore.ensureAuthenticatedAsync();
  const ascApiKey = await ctx.appStore.createAscApiKeyAsync(ctx.analytics, {
    nickname: getAscApiKeyName(purpose),
  });
  return await getMinimalAscApiKeyAsync(ascApiKey);
}

export function getAscApiKeyName(purpose: AppStoreApiKeyPurpose): string {
  const nameParts = ['[Expo]', purpose, nanoid(10)];
  return nameParts.join(' ');
}

async function promptForAscApiKeyAsync(ctx: CredentialsContext): Promise<MinimalAscApiKey | null> {
  const shouldAutoGenerateCredentials = await shouldAutoGenerateCredentialsAsync(ascApiKeyIdSchema);
  if (shouldAutoGenerateCredentials) {
    return null;
  }
  const ascApiKeyPath = await promptForAscApiKeyPathAsync(ctx);
  const { keyP8Path, keyId, issuerId } = ascApiKeyPath;
  return { keyP8: await fs.readFile(keyP8Path, 'utf-8'), keyId, issuerId };
}

async function promptForKeyP8AndIdAsync(): Promise<Pick<AscApiKeyPath, 'keyP8Path' | 'keyId'>> {
  Log.log(
    chalk.bold(
      'An App Store Connect Api key is required to upload your app to the Apple App Store Connect'
    )
  );
  Log.log(
    `If you're not sure what this is or how to create one, ${learnMore(
      'https://expo.fyi/creating-asc-api-key'
    )}`
  );

  const { keyP8Path } = await promptAsync({
    type: 'text',
    name: 'keyP8Path',
    message: 'Path to App Store Connect API Key:',
    initial: 'AuthKey_ABCD.p8',
    // eslint-disable-next-line async-protect/async-suffix
    validate: async (filePath: string) => {
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          return true;
        }
        return 'Input is not a file.';
      } catch {
        return 'File does not exist.';
      }
    },
  });
  const regex = /^AuthKey_(?<keyId>\w+)\.p8$/; // Common ASC Api file name downloaded from Apple
  const bestEffortKeyId = path.basename(keyP8Path).match(regex)?.groups?.keyId;
  const { keyId } = await getCredentialsFromUserAsync(ascApiKeyIdSchema, {
    keyId: bestEffortKeyId,
  });
  return { keyId, keyP8Path };
}

async function getBestEffortIssuerIdAsync(
  ctx: CredentialsContext,
  ascApiKeyId: string
): Promise<string | null> {
  if (!ctx.appStore.authCtx) {
    return null;
  }
  const ascApiKeyInfo = await ctx.appStore.getAscApiKeyAsync(ascApiKeyId);
  return ascApiKeyInfo?.issuerId ?? null;
}

export async function getAscApiKeysFromAccountAsync(
  ctx: CredentialsContext,
  account: AccountFragment,
  { filterDifferentAppleTeam }: { filterDifferentAppleTeam?: boolean } = {}
): Promise<AppStoreConnectApiKeyFragment[]> {
  const ascApiKeysForAccount = await ctx.ios.getAscApiKeysForAccountAsync(
    ctx.graphqlClient,
    account
  );

  if (!filterDifferentAppleTeam) {
    return ascApiKeysForAccount;
  } else {
    return filterKeysFromDifferentAppleTeam(ctx, ascApiKeysForAccount);
  }
}

export async function selectAscApiKeysFromAccountAsync(
  ctx: CredentialsContext,
  account: AccountFragment,
  { filterDifferentAppleTeam }: { filterDifferentAppleTeam?: boolean } = {}
): Promise<AppStoreConnectApiKeyFragment | null> {
  const ascApiKeysForAccount = await getAscApiKeysFromAccountAsync(ctx, account, {
    filterDifferentAppleTeam,
  });
  if (ascApiKeysForAccount.length === 0) {
    if (filterDifferentAppleTeam) {
      const maybeAppleTeamId = ctx.appStore.authCtx?.team.id;
      Log.warn(
        `There are no App Store Connect API Keys in your EAS account${
          maybeAppleTeamId ? ` matching Apple Team ID: ${maybeAppleTeamId}.` : '.'
        }`
      );
    } else {
      Log.warn(`There are no App Store Connect API Keys available in your EAS account.`);
    }
    return null;
  }
  return await selectAscApiKeysAsync(ascApiKeysForAccount);
}

async function selectAscApiKeysAsync(
  ascApiKeys: AppStoreConnectApiKeyFragment[]
): Promise<AppStoreConnectApiKeyFragment | null> {
  const sortedAscApiKeys = sortAscApiKeysByUpdatedAtDesc(ascApiKeys);
  const { chosenAscApiKey } = await promptAsync({
    type: 'select',
    name: 'chosenAscApiKey',
    message: 'Select an API Key from the list:',
    choices: sortedAscApiKeys.map(ascApiKey => ({
      title: formatAscApiKey(ascApiKey),
      value: ascApiKey,
    })),
  });
  return chosenAscApiKey;
}

function filterKeysFromDifferentAppleTeam(
  ctx: CredentialsContext,
  keys: AppStoreConnectApiKeyFragment[]
): AppStoreConnectApiKeyFragment[] {
  if (!ctx.appStore.authCtx) {
    return keys;
  }
  const teamId = ctx.appStore.authCtx.team.id;
  return keys.filter(key => !key.appleTeam || key.appleTeam?.appleTeamIdentifier === teamId);
}

export function sortAscApiKeysByUpdatedAtDesc(
  keys: AppStoreConnectApiKeyFragment[]
): AppStoreConnectApiKeyFragment[] {
  return keys.sort(
    (keyA, keyB) => new Date(keyB.updatedAt).getTime() - new Date(keyA.updatedAt).getTime()
  );
}

export function formatAscApiKey(ascApiKey: AppStoreConnectApiKeyFragment): string {
  const { keyIdentifier, appleTeam, name, updatedAt } = ascApiKey;
  let line: string = '';
  line += `Key ID: ${keyIdentifier}`;

  if (name) {
    line += chalk.gray(`\n    Name: ${name}`);
  }
  if (appleTeam) {
    line += chalk.gray(`\n    ${formatAppleTeam(appleTeam)}`);
  }

  line += chalk.gray(`\n    Updated: ${fromNow(new Date(updatedAt))} ago`);
  return line;
}
