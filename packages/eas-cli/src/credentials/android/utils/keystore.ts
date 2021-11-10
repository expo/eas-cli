import spawnAsync from '@expo/spawn-async';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { Analytics, BuildEvent } from '../../../analytics/commands/events';
import { AndroidKeystoreType } from '../../../graphql/generated';
import Log from '../../../log';
import { getTmpDirectory } from '../../../utils/paths';
import { KeystoreWithType } from '../credentials';

export async function keytoolCommandExistsAsync(): Promise<boolean> {
  try {
    await spawnAsync('keytool');
  } catch (error) {
    return false;
  }
  return true;
}

async function ensureKeytoolCommandExistsAsync(): Promise<void> {
  if (!(await keytoolCommandExistsAsync())) {
    Log.error('keytool is required to run this command, make sure you have it installed?');
    Log.warn('keytool is a part of OpenJDK: https://openjdk.java.net/');
    Log.warn('Also make sure that keytool is in your PATH after installation.');
    throw new Error('keytool not found');
  }
}

enum KeystoreCreateStep {
  Attempt = 'attempt',
  Fail = 'fail',
  Success = 'success',
}

export async function generateRandomKeystoreAsync(projectId: string): Promise<KeystoreWithType> {
  const keystoreData = {
    keystorePassword: crypto.randomBytes(16).toString('hex'),
    keyPassword: crypto.randomBytes(16).toString('hex'),
    keyAlias: crypto.randomBytes(16).toString('hex'),
  };
  return await createKeystoreAsync(keystoreData, projectId);
}

async function createKeystoreAsync(
  credentials: {
    keystorePassword: string;
    keyAlias: string;
    keyPassword: string;
  },
  projectId: string
): Promise<KeystoreWithType> {
  Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
    project_id: projectId,
    step: KeystoreCreateStep.Attempt,
    type: AndroidKeystoreType.Jks,
  });

  try {
    await ensureKeytoolCommandExistsAsync();
  } catch (error: any) {
    Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
      project_id: projectId,
      step: KeystoreCreateStep.Fail,
      reason: error.message,
      type: AndroidKeystoreType.Jks,
    });
    throw error;
  }

  await fs.mkdirp(getTmpDirectory());
  const keystorePath = path.join(getTmpDirectory(), `${uuidv4()}-keystore.jks`);
  try {
    await spawnAsync('keytool', [
      '-genkey',
      '-v',
      '-storetype',
      'JKS',
      '-storepass',
      credentials.keystorePassword,
      '-keypass',
      credentials.keyPassword,
      '-keystore',
      keystorePath,
      '-alias',
      credentials.keyAlias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-dname',
      `CN=,OU=,O=,L=,S=,C=US`,
    ]);

    Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
      project_id: projectId,
      step: KeystoreCreateStep.Success,
      type: AndroidKeystoreType.Jks,
    });

    return {
      ...credentials,
      keystore: await fs.readFile(keystorePath, 'base64'),
      type: AndroidKeystoreType.Jks,
    };
  } catch (error: any) {
    Analytics.logEvent(BuildEvent.ANDROID_KEYSTORE_CREATE, {
      project_id: projectId,
      step: KeystoreCreateStep.Fail,
      reason: error.message,
      type: AndroidKeystoreType.Jks,
    });
    throw error;
  } finally {
    await fs.remove(keystorePath);
  }
}
