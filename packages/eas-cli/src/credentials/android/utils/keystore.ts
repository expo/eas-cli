import spawnAsync from '@expo/spawn-async';
import commandExists from 'command-exists';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import log from '../../../log';
import { getTmpDirectory } from '../../../utils/paths';
import { Keystore } from '../credentials';

export async function keytoolCommandExistsAsync(): Promise<boolean> {
  try {
    await commandExists('keytool');
    return true;
  } catch (err) {
    return false;
  }
}

async function _ensureKeytoolCommandExistsAsync(): Promise<void> {
  if (!(await keytoolCommandExistsAsync())) {
    log.error('keytool is required to run this command, make sure you have it installed?');
    log.warn('keytool is a part of OpenJDK: https://openjdk.java.net/');
    log.warn('Also make sure that keytool is in your PATH after installation.');
    throw new Error('keytool not found');
  }
}

async function _writeFileToTmpAsync(base64Data: string, nameSuffix: string = ''): Promise<string> {
  await fs.mkdirp(getTmpDirectory());
  const filePath = path.join(getTmpDirectory(), `${uuidv4()}${nameSuffix}`);

  await fs.writeFile(filePath, base64Data, 'base64');
  return filePath;
}

export async function exportCertificateAsync(
  keystore: Keystore,
  options?: { rfcFormat: boolean }
): Promise<string> {
  await _ensureKeytoolCommandExistsAsync();
  const keystorePath = await _writeFileToTmpAsync(keystore.keystore, '-keystore.jks');
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
  log(
    `${linePrefix}Google Certificate Fingerprint:     ${googleHash.replace(/(.{2}(?!$))/g, '$1:')}`
  );
  log(`${linePrefix}Google Certificate Hash (SHA-1):    ${googleHash}`);
  log(`${linePrefix}Google Certificate Hash (SHA-256):  ${googleHash256}`);
  log(`${linePrefix}Facebook Key Hash:                  ${fbHash}`);
}

async function _createKeystoreAsync(credentials: {
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}): Promise<Keystore> {
  await _ensureKeytoolCommandExistsAsync();
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
    keystorePassword: uuidv4().replace(/-/g, ''),
    keyPassword: uuidv4().replace(/-/g, ''),
    keyAlias: uuidv4().replace(/-/g, ''),
  };
  return await _createKeystoreAsync(keystoreData);
}
