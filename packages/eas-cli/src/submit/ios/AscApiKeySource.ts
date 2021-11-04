import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { promptForAscApiKeyPathAsync } from '../../credentials/ios/actions/AscApiKeyUtils';
import { AscApiKeyPath, MinimalAscApiKey } from '../../credentials/ios/credentials';
import Log from '../../log';
import { SubmissionContext } from '../context';
import { isExistingFileAsync } from '../utils/files';

export enum AscApiKeySourceType {
  path,
  prompt,
}

interface AscApiKeySourceBase {
  sourceType: AscApiKeySourceType;
}

interface AscApiKeyPromptSource extends AscApiKeySourceBase {
  sourceType: AscApiKeySourceType.prompt;
}

interface AscApiKeyEnvVarSource extends AscApiKeySourceBase {
  sourceType: AscApiKeySourceType.path;
  path: AscApiKeyPath;
}

export type AscApiKeySource = AscApiKeyEnvVarSource | AscApiKeyPromptSource;

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
