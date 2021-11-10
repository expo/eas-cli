import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
// (dsokal) We actually want to use node-fetch but the change is in progress.
// See https://github.com/expo/eas-cli/issues/32 for context.
// eslint-disable-next-line no-restricted-imports
import fetch from 'node-fetch';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { Analytics, BuildEvent } from '../../../analytics/events';
import { AndroidKeystoreType } from '../../../graphql/generated';
import { KeystoreGenerationUrlMutation } from '../../../graphql/mutations/KeystoreGenerationUrlMutation';
import Log from '../../../log';
import { ora } from '../../../ora';
import { getTmpDirectory } from '../../../utils/paths';
import { KeystoreWithType } from '../credentials';

interface KeystoreParams {
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}

export async function keytoolCommandExistsAsync(): Promise<boolean> {
  try {
    await spawnAsync('keytool');
    return true;
  } catch (error) {
    return false;
  }
}

enum KeystoreCreateStep {
  Attempt = 'attempt',
  Fail = 'fail',
  Success = 'success',
}

export async function generateRandomKeystoreAsync(projectId: string): Promise<KeystoreWithType> {
  const keystoreData: KeystoreParams = {
    keystorePassword: crypto.randomBytes(16).toString('hex'),
    keyPassword: crypto.randomBytes(16).toString('hex'),
    keyAlias: crypto.randomBytes(16).toString('hex'),
  };
  return await createKeystoreAsync(keystoreData, projectId);
}

async function createKeystoreAsync(
  keystoreParams: KeystoreParams,
  projectId: string
): Promise<KeystoreWithType> {
  Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
    project_id: projectId,
    step: KeystoreCreateStep.Attempt,
    type: AndroidKeystoreType.Jks,
  });
  try {
    let keystore: KeystoreWithType | undefined;
    let localAttempt = false;
    if (await keytoolCommandExistsAsync()) {
      try {
        localAttempt = true;
        keystore = await createKeystoreLocallyAsync(keystoreParams);
      } catch {
        Log.error('Failed to generate keystore locally. Falling back to cloud generation.');
      }
    }
    if (!keystore) {
      keystore = await createKeystoreInCloudAsync(keystoreParams, {
        showKeytoolDetectionMsg: !localAttempt,
      });
    }
    Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
      project_id: projectId,
      step: KeystoreCreateStep.Success,
      type: AndroidKeystoreType.Jks,
    });
    return keystore;
  } catch (error: any) {
    Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
      project_id: projectId,
      step: KeystoreCreateStep.Fail,
      reason: error.message,
      type: AndroidKeystoreType.Jks,
    });
    throw error;
  }
}

async function createKeystoreLocallyAsync(
  keystoreParams: KeystoreParams
): Promise<KeystoreWithType> {
  await fs.mkdirp(getTmpDirectory());
  const keystorePath = path.join(getTmpDirectory(), `${uuidv4()}-keystore.jks`);
  try {
    await spawnAsync('keytool', [
      '-genkey',
      '-v',
      '-storetype',
      'JKS',
      '-storepass',
      keystoreParams.keystorePassword,
      '-keypass',
      keystoreParams.keyPassword,
      '-keystore',
      keystorePath,
      '-alias',
      keystoreParams.keyAlias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-dname',
      `CN=,OU=,O=,L=,S=,C=US`,
    ]);
    return {
      ...keystoreParams,
      keystore: await fs.readFile(keystorePath, 'base64'),
      type: AndroidKeystoreType.Jks,
    };
  } finally {
    await fs.remove(keystorePath);
  }
}

interface KeystoreServiceResult {
  keystoreBase64: string;
  keystorePassword: string;
  keyPassword: string;
  keyAlias: string;
}

async function createKeystoreInCloudAsync(
  keystoreParams: KeystoreParams,
  { showKeytoolDetectionMsg = true } = {}
): Promise<KeystoreWithType> {
  if (showKeytoolDetectionMsg) {
    Log.warn(`Detected that you do not have ${chalk.bold('keytool')} installed locally.`);
  }
  const spinner = ora('Generating keystore in the cloud...').start();
  try {
    const url = await KeystoreGenerationUrlMutation.createKeystoreGenerationUrlAsync();
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(keystoreParams),
      headers: { 'Content-Type': 'application/json' },
    });
    const result: KeystoreServiceResult = await response.json();
    spinner.succeed();
    return {
      type: AndroidKeystoreType.Jks,
      keystore: result.keystoreBase64,
      keystorePassword: result.keystorePassword,
      keyAlias: result.keyAlias,
      keyPassword: result.keyPassword,
    };
  } catch (err: any) {
    spinner.fail();
    throw err;
  }
}
