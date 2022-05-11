import { getX509Asn1ByFriendlyName, parsePKCS12 } from '@expo/pkcs12';
import jks from 'jks-js';
import { asn1 } from 'node-forge';

import { AndroidKeystoreType } from '../../../graphql/generated';
import Log from '../../../log';
import { Keystore, KeystoreWithType } from '../credentials';

export function getKeystoreWithType(keystore: Keystore): KeystoreWithType {
  const type = getKeystoreType(keystore);
  return { ...keystore, type };
}

export function getKeystoreType(keystore: Keystore): AndroidKeystoreType {
  if (isPKCSKeystore(keystore)) {
    return AndroidKeystoreType.Pkcs12;
  } else if (isJKSKeystore(keystore)) {
    return AndroidKeystoreType.Jks;
  }
  return AndroidKeystoreType.Unknown;
}

function isPKCSKeystore(keystore: Keystore): boolean {
  try {
    parsePKCS12(keystore.keystore, keystore.keystorePassword);
    return true;
  } catch {
    return false;
  }
}

function isJKSKeystore(keystore: Keystore): boolean {
  try {
    jks.parseJks(Buffer.from(keystore.keystore, 'base64'), keystore.keystorePassword);
    return true;
  } catch {
    return false;
  }
}

export function validateKeystore(keystore: KeystoreWithType): void {
  if (keystore.type === AndroidKeystoreType.Jks) {
    getPemFromJksKeystore(keystore);
  } else if (keystore.type === AndroidKeystoreType.Pkcs12) {
    getX509Asn1FromPKCS12Keystore(keystore.keystore, keystore.keystorePassword, keystore.keyAlias);
  } else if (keystore.type === AndroidKeystoreType.Unknown) {
    Log.warn('Unknown keystore type, skipping validation.');
  } else {
    Log.warn(`Unsupported keystore type: ${keystore.type}, skipping validation.`);
  }
}

function getPemFromJksKeystore(keystore: Keystore): string {
  const keystoreEntries = jks.parseJks(
    Buffer.from(keystore.keystore, 'base64'),
    keystore.keystorePassword
  );
  // keystore entries are case insensitive in both keytool and jks-js implementations
  const keystoreEntry = keystoreEntries.find(
    (entry: any) => entry.alias.toLowerCase() === keystore.keyAlias.toLowerCase()
  );
  if (!keystoreEntry) {
    throw new Error(`JKS Keystore does not contain alias: ${keystore.keyAlias}`);
  }
  const { protectedPrivateKey } = keystoreEntry;
  try {
    return jks.decrypt(protectedPrivateKey, keystore.keyPassword);
  } catch (e: any) {
    throw new Error(`${e.message}: Check that your key password is correct`);
  }
}

function getX509Asn1FromPKCS12Keystore(
  p12BufferOrBase64String: Buffer | string,
  maybePassword: string | null,
  keyAlias: string
): asn1.Asn1 {
  let x509Asn1;
  try {
    const p12 = parsePKCS12(p12BufferOrBase64String, maybePassword);
    x509Asn1 = getX509Asn1ByFriendlyName(p12, keyAlias);
  } catch (e: any) {
    throw new Error(`Invalid PKCS#12 (.p12) keystore: ${e.message}`);
  }
  if (!x509Asn1) {
    throw new Error(
      `PKCS#12 keystore: Unable to get certificate under alias: ${keyAlias}. Run this to find the available aliases: keytool -list -v -keystore [your-keystore-path]`
    );
  }
  return x509Asn1;
}
