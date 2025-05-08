import {
  BuildCacheProviderPlugin,
  CalculateFingerprintHashProps,
  ResolveBuildCacheProps,
  UploadBuildCacheProps,
} from '@expo/config';
import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { isDevClientBuild, isSpawnResultError } from './helpers';
import Log from './log';

async function resolveBuildCacheAsync({
  projectRoot,
  platform,
  fingerprintHash,
  runOptions,
}: ResolveBuildCacheProps): Promise<string | null> {
  const easJsonPath = path.join(projectRoot, 'eas.json');
  if (!(await fs.exists(easJsonPath))) {
    Log.debug('eas.json not found, skip checking for remote builds');
    return null;
  }

  Log.log(
    chalk`{whiteBright \u203A} {bold Searching builds with matching fingerprint on EAS servers}`
  );
  try {
    const results = await spawnAsync(
      'npx',
      [
        'eas-cli',
        'build:download',
        `--platform=${platform}`,
        `--fingerprint=${fingerprintHash}`,
        '--non-interactive',
        isDevClientBuild({ runOptions, projectRoot }) ? '--dev-client' : '--no-dev-client',
        '--json',
      ],
      {
        cwd: projectRoot,
      }
    );

    Log.log(chalk`{whiteBright \u203A} {bold Successfully downloaded cached build}`);
    // {
    //   "path": "/var/folders/03/lppcpcnn61q3mz5ckzmzd8w80000gn/T/eas-cli-nodejs/eas-build-run-cache/c0f9ba9c-0cf1-4c5c-8566-b28b7971050f_22f1bbfa-1c09-4b67-9e4a-721906546b58.app"
    // }
    const json = JSON.parse(results.stdout.trim());
    return json?.path;
  } catch (error) {
    Log.debug('eas-cli error:', error);
    // @TODO(2025-04-11): remove this in a future release
    if (isSpawnResultError(error) && error.stderr.includes('command build:download not found')) {
      Log.warn(
        `To take advantage of EAS build cache provider, upgrade your eas-cli installation to latest.`
      );
    }
    return null;
  }
}

async function uploadBuildCacheAsync({
  projectRoot,
  platform,
  fingerprintHash,
  buildPath,
}: UploadBuildCacheProps): Promise<string | null> {
  const easJsonPath = path.join(projectRoot, 'eas.json');
  if (!(await fs.exists(easJsonPath))) {
    Log.debug('eas.json not found, skip uploading builds');
    return null;
  }

  try {
    Log.log(chalk`{whiteBright \u203A} {bold Uploading build to EAS}`);
    const results = await spawnAsync(
      'npx',
      [
        'eas-cli',
        'upload',
        `--platform=${platform}`,
        `--fingerprint=${fingerprintHash}`,
        buildPath ? `--build-path=${buildPath}` : '',
        '--non-interactive',
        '--json',
      ],
      {
        cwd: projectRoot,
      }
    );
    // {
    //   "url": "/var/folders/03/lppcpcnn61q3mz5ckzmzd8w80000gn/T/eas-cli-nodejs/eas-build-run-cache/c0f9ba9c-0cf1-4c5c-8566-b28b7971050f_22f1bbfa-1c09-4b67-9e4a-721906546b58.app"
    // }
    const json = JSON.parse(results.stdout.trim());
    Log.log(chalk`{whiteBright \u203A} {bold Build successfully uploaded: ${json?.url}}`);
    return json?.url;
  } catch (error) {
    Log.debug('eas-cli error:', error);
  }
  return null;
}

async function calculateEASFingerprintHashAsync({
  projectRoot,
  platform,
}: CalculateFingerprintHashProps): Promise<string | null> {
  // prefer using `eas fingerprint:generate` because it automatically upload sources
  try {
    const results = await spawnAsync(
      'npx',
      ['eas-cli', 'fingerprint:generate', `--platform=${platform}`, '--json', '--non-interactive'],
      {
        cwd: projectRoot,
      }
    );
    // {
    //   "hash": "203f960b965e154b77dc31c6c42e5582e8d77196"
    // }
    const json = JSON.parse(results.stdout.trim());
    return json?.hash;
  } catch (error) {
    Log.debug('eas-cli error:', error);
  }
  return null;
}

const EASBuildCacheProvider: BuildCacheProviderPlugin = {
  resolveBuildCache: resolveBuildCacheAsync,
  uploadBuildCache: uploadBuildCacheAsync,
  calculateFingerprintHash: calculateEASFingerprintHashAsync,
};

export default EASBuildCacheProvider;
