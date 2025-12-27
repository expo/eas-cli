import { Platform } from '@expo/eas-build-job';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { AppStoreConnectApiKeyQuery } from '../../graphql/queries/AppStoreConnectApiKeyQuery';
import Log from '../../log';
import { SubmissionContext } from '../context';
import {
  AscApiKeySource,
  AscApiKeySourceType,
  getAscApiKeyResultAsync,
} from '../ios/AscApiKeySource';

interface AscKeyMaterial {
  keyP8: string;
  keyId: string;
  issuerId: string;
}

interface TmpAscFiles {
  tmpDir: string;
  tmpPath: string;
}

export async function submitLocalIosAsync(
  ctx: SubmissionContext<Platform.IOS>,
  flagsWithPlatform: any
): Promise<void> {
  // local submit currently only supports a local path to an .ipa
  const { path: ipaPath } = ctx.archiveFlags as { path?: string };
  if (!ipaPath) {
    throw new Error('--local currently requires --path to a local .ipa file');
  }
  if (!(await fs.pathExists(ipaPath))) {
    throw new Error(`File ${ipaPath} does not exist`);
  }

  const { ascApiKeyPath, ascApiKeyIssuerId, ascApiKeyId } = ctx.profile as any;

  let ascSource: AscApiKeySource;
  if (ascApiKeyPath && ascApiKeyIssuerId && ascApiKeyId) {
    ascSource = {
      sourceType: AscApiKeySourceType.path,
      path: { keyP8Path: ascApiKeyPath, keyId: ascApiKeyId, issuerId: ascApiKeyIssuerId },
    };
  } else if (ascApiKeyPath || ascApiKeyIssuerId || ascApiKeyId) {
    const message =
      'ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json';
    if (ctx.nonInteractive) {
      throw new Error(message);
    }
    Log.warn(message);
    ascSource = { sourceType: AscApiKeySourceType.prompt };
  } else {
    ascSource = { sourceType: AscApiKeySourceType.credentialsService };
  }

  const ascKey = await getAscKeyMaterialAsync(ctx, ascSource);

  const { tmpDir, tmpPath } = await writeTmpAscJsonAsync(ascKey);

  try {
    ensureFastlaneAvailable();

    const args: string[] = ['pilot', 'upload', '-i', ipaPath, '--api_key_path', tmpPath];

    if (ctx.whatToTest) {
      args.push('--changelog', ctx.whatToTest);
    }

    if (ctx.groups && ctx.groups.length > 0) {
      args.push('--groups', ctx.groups.join(','));
      if (flagsWithPlatform?.external) {
        args.push('--distribute_external');
      }
    }

    if (ctx.isVerboseFastlaneEnabled) {
      Log.log(`Running: fastlane ${args.join(' ')}`);
    } else {
      Log.log('Uploading to App Store Connect via fastlane');
    }

    await runFastlane(args);
  } finally {
    await cleanupTmpAsync(tmpPath, tmpDir);
  }
}

async function getAscKeyMaterialAsync(
  ctx: SubmissionContext<Platform.IOS>,
  ascSource: AscApiKeySource
): Promise<AscKeyMaterial> {
  const ascResult = await getAscApiKeyResultAsync(ctx, ascSource);

  if ('ascApiKeyId' in ascResult.result) {
    const key = await AppStoreConnectApiKeyQuery.getByIdAsync(
      ctx.graphqlClient,
      ascResult.result.ascApiKeyId
    );
    return { keyP8: key.keyP8, keyId: key.keyIdentifier, issuerId: key.issuerIdentifier };
  }

  const r = ascResult.result as any;
  return { keyP8: r.keyP8, keyId: r.keyId, issuerId: r.issuerId };
}

async function writeTmpAscJsonAsync(key: AscKeyMaterial): Promise<TmpAscFiles> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-asc-'));
  const tmpPath = path.join(tmpDir, 'asc.json');
  const ascJson = { key_id: key.keyId, issuer_id: key.issuerId, key: key.keyP8 };
  await fs.writeFile(tmpPath, JSON.stringify(ascJson));
  return { tmpDir, tmpPath };
}

function ensureFastlaneAvailable(): void {
  const which = spawnSync('fastlane', ['--version'], { stdio: 'ignore' });
  if (which.status !== 0) {
    throw new Error(
      'fastlane is not installed or not available in PATH. Install fastlane to perform local ASC key uploads.'
    );
  }
}

function runFastlane(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('fastlane', args, { stdio: 'inherit', env: process.env });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) {
        Log.log('Uploaded to App Store Connect via fastlane');
        resolve();
      } else {
        reject(new Error(`fastlane exited with code ${code}`));
      }
    });
  });
}

async function cleanupTmpAsync(tmpPath: string, tmpDir: string): Promise<void> {
  await fs.remove(tmpPath).catch(() => {});
  await fs.remove(tmpDir).catch(() => {});
}

export default submitLocalIosAsync;
