import { Platform } from '@expo/eas-build-job';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs-extra';
import StreamZip from 'node-stream-zip';
import os from 'os';
import path from 'path';

import { AppStoreConnectApiKeyQuery } from '../../graphql/queries/AppStoreConnectApiKeyQuery';
import Log from '../../log';
import { parseBinaryPlistBuffer } from '../../utils/plist';
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
  fastlaneArgs?: string
): Promise<void> {
  // local submit currently only supports a local path to an .ipa
  const { path: ipaPath } = ctx.archiveFlags as { path?: string };
  if (!ipaPath) {
    throw new Error('--local currently requires --path to a local .ipa file');
  }
  if (!(await fs.pathExists(ipaPath))) {
    throw new Error(`File ${ipaPath} does not exist`);
  }

  const profile = ctx.profile;
  const { ascApiKeyPath, ascApiKeyIssuerId, ascApiKeyId } = profile ?? {};

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
    }

    // Append extra fastlane arguments passed via the CLI (--fastlane-args)
    if (typeof fastlaneArgs === 'string' && fastlaneArgs.trim().length > 0) {
      const tokens = splitArgsString(fastlaneArgs);
      if (tokens.length > 0) {
        args.push(...tokens);
      }
    }

    if (ctx.isVerboseFastlaneEnabled) {
      Log.log(`Running: fastlane ${args.join(' ')}`);
    } else {
      Log.log('Uploading to App Store Connect via fastlane');
    }
    await printInfoPlistAsync(ipaPath);
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

  const r = ascResult.result;
  return { keyP8: r.keyP8, keyId: r.keyId, issuerId: r.issuerId };
}

async function writeTmpAscJsonAsync(key: AscKeyMaterial): Promise<TmpAscFiles> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-asc-'));
  const tmpPath = path.join(tmpDir, 'asc.json');
  const ascJson = { key_id: key.keyId, issuer_id: key.issuerId, key: key.keyP8 };
  await fs.writeFile(tmpPath, JSON.stringify(ascJson));
  try {
    // Restrict permissions to owner only where supported (Unix-like systems)
    await fs.chmod(tmpPath, 0o600);
  } catch (err) {
    // ignore chmod errors on platforms that don't support it (e.g., Windows)
  }
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

async function printInfoPlistAsync(ipaPath: string): Promise<void> {
  // Parse and print Info.plist from the provided .ipa before running fastlane
  try {
    const zip = new StreamZip.async({ file: ipaPath });
    try {
      const entries = await zip.entries();
      const entriesKeys = Object.keys(entries);
      for (const entryPath of entriesKeys) {
        const infoPlistRegex = /^Payload\/[^/]+\.app\/Info\.plist$/;
        if (infoPlistRegex.test(entryPath)) {
          const infoPlistBuffer = await zip.entryData(entries[entryPath]);
          try {
            const infoPlist = parseBinaryPlistBuffer(infoPlistBuffer);
            Log.log(`Parsed Info.plist: ${JSON.stringify(infoPlist, null, 2)}`);
          } catch (err) {
            Log.warn(`Failed to parse Info.plist from ipa: ${err}`);
          }
          break;
        }
      }
    } catch (err) {
      Log.warn(`Error reading ipa while extracting Info.plist: ${err}`);
    } finally {
      await zip.close();
    }
  } catch (err) {
    Log.warn(`Failed to open ipa for reading Info.plist: ${err}`);
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

// Split a command-line string into argv tokens, honoring single and double quotes.
export function splitArgsString(input: string): string[] {
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match[1] !== undefined) {
      result.push(match[1]);
    } else if (match[2] !== undefined) {
      result.push(match[2]);
    } else {
      result.push(match[0]);
    }
  }
  return result;
}

export default submitLocalIosAsync;
