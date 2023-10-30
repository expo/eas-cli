import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import {
  AppStoreApiKeyPurpose,
  promptForAscApiKeyPathAsync,
} from '../../credentials/ios/actions/AscApiKeyUtils';
import { SetUpAscApiKey } from '../../credentials/ios/actions/SetUpAscApiKey';
import { AscApiKeyPath, MinimalAscApiKey } from '../../credentials/ios/credentials';
import Log from '../../log';
import {
  AmbiguousBundleIdentifierError,
  INVALID_BUNDLE_IDENTIFIER_MESSAGE,
  getBundleIdentifierAsync,
  isBundleIdentifierValid,
} from '../../project/ios/bundleIdentifier';
import { promptAsync } from '../../prompts';
import { SubmissionContext } from '../context';
import { isExistingFileAsync } from '../utils/files';

export enum AscApiKeySourceType {
  path,
  prompt,
  credentialsService,
}

interface AscApiKeySourceBase {
  sourceType: AscApiKeySourceType;
}

interface AscApiKeyCredentialsServiceSource extends AscApiKeySourceBase {
  sourceType: AscApiKeySourceType.credentialsService;
}

interface AscApiKeyPromptSource extends AscApiKeySourceBase {
  sourceType: AscApiKeySourceType.prompt;
}

interface AscApiKeyEnvVarSource extends AscApiKeySourceBase {
  sourceType: AscApiKeySourceType.path;
  path: AscApiKeyPath;
}

export type AscApiKeySource =
  | AscApiKeyEnvVarSource
  | AscApiKeyPromptSource
  | AscApiKeyCredentialsServiceSource;

type AscApiKeySummary = {
  source: 'local' | 'EAS servers';
  path?: string;
  keyId: string;
  name?: string;
};

export type AscApiKeyFromExpoServers = {
  ascApiKeyId: string;
};

export type AscApiKeyResult = {
  result: MinimalAscApiKey | AscApiKeyFromExpoServers;
  summary: AscApiKeySummary;
};

export async function getAscApiKeyResultAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: AscApiKeySource
): Promise<AscApiKeyResult> {
  if (source.sourceType === AscApiKeySourceType.credentialsService) {
    return await getAscApiKeyFromCredentialsServiceAsync(ctx);
  } else {
    return await getAscApiKeyLocallyAsync(ctx, source);
  }
}

async function maybeGetIosBundleIdentifierAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<string | null> {
  try {
    return await getBundleIdentifierAsync(ctx.projectDir, ctx.exp, ctx.vcsClient);
  } catch (error: any) {
    if (error instanceof AmbiguousBundleIdentifierError) {
      Log.warn(
        'bundleIdentifier in the Xcode project is ambiguous, specify it via "bundleIdentifier" field in the submit profile in the eas.json.'
      );
      return null;
    }
    throw new Error(`Failed to resolve bundleIdentifier in the Xcode project: ${error.message}.`);
  }
}

async function promptForBundleIdentifierAsync(): Promise<string> {
  const { bundleIdentifier } = await promptAsync({
    name: 'bundleIdentifier',
    message: 'Bundle identifier:',
    type: 'text',
    validate: value => (isBundleIdentifierValid(value) ? true : INVALID_BUNDLE_IDENTIFIER_MESSAGE),
  });
  return bundleIdentifier;
}

async function getAscApiKeyFromCredentialsServiceAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<AscApiKeyResult> {
  const bundleIdentifier =
    ctx.applicationIdentifierOverride ??
    ctx.profile.bundleIdentifier ??
    (await maybeGetIosBundleIdentifierAsync(ctx)) ??
    (await promptForBundleIdentifierAsync());
  Log.log(`Looking up credentials configuration for ${bundleIdentifier}...`);

  const appLookupParams = {
    account: nullthrows(
      ctx.user.accounts.find(a => a.name === ctx.accountName),
      `You do not have access to account: ${ctx.accountName}`
    ),
    projectName: ctx.projectName,
    bundleIdentifier,
  };
  const setupAscApiKeyAction = new SetUpAscApiKey(
    appLookupParams,
    AppStoreApiKeyPurpose.SUBMISSION_SERVICE
  );
  const iosAppCredentials = await setupAscApiKeyAction.runAsync(ctx.credentialsCtx);
  const ascKeyForSubmissions = nullthrows(
    iosAppCredentials.appStoreConnectApiKeyForSubmissions,
    `An EAS Submit ASC Api Key could not be found for ${iosAppCredentials.appleAppIdentifier.bundleIdentifier}`
  );
  const { id, keyIdentifier, name } = ascKeyForSubmissions;
  Log.log(`Using Api Key ID: ${keyIdentifier}${name ? ` (${name})` : ''}`);
  return {
    result: {
      ascApiKeyId: id,
    },
    summary: {
      source: 'EAS servers',
      keyId: keyIdentifier,
      name: name ?? undefined,
    },
  };
}

export async function getAscApiKeyLocallyAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: AscApiKeySource
): Promise<AscApiKeyResult> {
  const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
  const { keyP8Path, keyId, issuerId } = ascApiKeyPath;
  const keyP8 = await fs.readFile(keyP8Path, 'utf-8');

  return {
    result: { keyP8, keyId, issuerId },
    summary: {
      source: 'local',
      path: keyP8Path,
      keyId,
    },
  };
}

export async function getAscApiKeyPathAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: AscApiKeySource
): Promise<AscApiKeyPath> {
  switch (source.sourceType) {
    case AscApiKeySourceType.path:
      return await handlePathSourceAsync(ctx, source);
    case AscApiKeySourceType.prompt:
      return await handlePromptSourceAsync(ctx, source);
    case AscApiKeySourceType.credentialsService:
      throw new Error(`AscApiKeySourceType ${source} does not return a path.`);
  }
}

async function handlePathSourceAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: AscApiKeyEnvVarSource
): Promise<AscApiKeyPath> {
  const { keyP8Path } = source.path;
  if (!(await isExistingFileAsync(keyP8Path))) {
    Log.warn(`File ${keyP8Path} doesn't exist.`);
    return await getAscApiKeyPathAsync(ctx, { sourceType: AscApiKeySourceType.prompt });
  }
  return source.path;
}

async function handlePromptSourceAsync(
  ctx: SubmissionContext<Platform.IOS>,
  _source: AscApiKeyPromptSource
): Promise<AscApiKeyPath> {
  const ascApiKeyPath = await promptForAscApiKeyPathAsync(ctx.credentialsCtx);
  return await getAscApiKeyPathAsync(ctx, {
    sourceType: AscApiKeySourceType.path,
    path: ascApiKeyPath,
  });
}
