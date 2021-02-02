import spawnAsync from '@expo/spawn-async';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import tempy from 'tempy';
import { v4 as uuidv4 } from 'uuid';

import Log from '../../../log';
import { getTmpDirectory } from '../../../utils/paths';
import { Keystore } from '../credentials';

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

async function writeFileToTmpAsync(base64Data: string, nameSuffix: string = ''): Promise<string> {
  await fs.mkdirp(getTmpDirectory());
  const filePath = path.join(getTmpDirectory(), `${uuidv4()}${nameSuffix}`);
  await fs.writeFile(filePath, base64Data, 'base64');
  return filePath;
}

export async function exportCertificateAsync(
  keystore: Keystore,
  options?: { rfcFormat: boolean }
): Promise<string> {
  await ensureKeytoolCommandExistsAsync();
  const keystorePath = await writeFileToTmpAsync(keystore.keystore, '-keystore.jks');
  const certPath = path.join(getTmpDirectory(), `${uuidv4()}.cer`);
  try {
    await spawnAsync('keytool', [
      '-exportcert',
      ...(options?.rfcFormat ? ['-rfc'] : []),
      '-keystore',
      keystorePath,
      '-storepass',
      keystore.keystorePassword,
      '-alias',
      keystore.keyAlias,
      '-file',
      certPath,
      '-noprompt',
      '-storetype',
      'JKS',
    ]);
    return await fs.readFile(certPath, 'base64');
  } finally {
    await fs.remove(keystorePath);
    await fs.remove(certPath);
  }
}

export async function logKeystoreHashesAsync(keystore: Keystore, linePrefix: string = '') {
  const base64Cert = await exportCertificateAsync(keystore);
  const data = Buffer.from(base64Cert, 'base64');
  const googleHash = crypto.createHash('sha1').update(data).digest('hex').toUpperCase();
  const googleHash256 = crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
  const fbHash = crypto.createHash('sha1').update(data).digest('base64');
  Log.log(
    `${linePrefix}Google Certificate Fingerprint:     ${googleHash.replace(/(.{2}(?!$))/g, '$1:')}`
  );
  Log.log(`${linePrefix}Google Certificate Hash (SHA-1):    ${googleHash}`);
  Log.log(`${linePrefix}Google Certificate Hash (SHA-256):  ${googleHash256}`);
  Log.log(`${linePrefix}Facebook Key Hash:                  ${fbHash}`);
}

async function createKeystoreAsync(credentials: {
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}): Promise<Keystore> {
  await ensureKeytoolCommandExistsAsync();
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
    return {
      ...credentials,
      keystore: await fs.readFile(keystorePath, 'base64'),
    };
  } finally {
    await fs.remove(keystorePath);
  }
}

export async function generateRandomKeystoreAsync(): Promise<Keystore> {
  const keystoreData = {
    keystorePassword: crypto.randomBytes(16).toString('hex'),
    keyPassword: crypto.randomBytes(16).toString('hex'),
    keyAlias: crypto.randomBytes(16).toString('hex'),
  };
  return await createKeystoreAsync(keystoreData);
}

export async function validateKeystoreAsync(keystore: Keystore): Promise<void> {
  await ensureKeytoolCommandExistsAsync();
  try {
    await tempy.write.task(Buffer.from(keystore.keystore, 'base64'), async keystorePath => {
      await spawnAsync('keytool', [
        '-list',
        '-keystore',
        keystorePath,
        '-storepass',
        keystore.keystorePassword,
        '-alias',
        keystore.keyAlias,
      ]);
    });
  } catch (e) {
    throw new Error(
      `An error occurred when validating the Android keystore: ${e.stdout ?? e.message}`
    );
  }
}
