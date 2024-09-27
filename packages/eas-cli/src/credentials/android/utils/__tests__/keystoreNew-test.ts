import { AndroidKeystoreType } from '../../../../graphql/generated';
import {
  testKeystore,
  testPKCS12EmptyPasswordKeystore,
  testPKCS12Keystore,
} from '../../../__tests__/fixtures-android';
import { getKeystoreType, getKeystoreWithType, validateKeystore } from '../keystoreNew';

describe('getKeystoreType', () => {
  it('identifies a valid jks keystore', async () => {
    const type = getKeystoreType(testKeystore);
    expect(type).toBe(AndroidKeystoreType.Jks);
  });
  it('identifies a valid pkcs12 keystore', async () => {
    const type = getKeystoreType(testPKCS12Keystore);
    expect(type).toBe(AndroidKeystoreType.Pkcs12);
  });
  it('identifies a jks keystore with bad password as unknown', async () => {
    const keystoreWithType = getKeystoreType({
      ...testKeystore,
      keystorePassword: 'not-the-password',
    });
    expect(keystoreWithType).toBe(AndroidKeystoreType.Unknown);
  });
  it('identifies a pkcs keystore with bad password as unknown', async () => {
    const keystoreWithType = getKeystoreType({
      ...testPKCS12Keystore,
      keystorePassword: 'not-the-password',
    });
    expect(keystoreWithType).toBe(AndroidKeystoreType.Unknown);
  });
  it('identifies a bogus keystore as unknown', async () => {
    const type = getKeystoreType({ ...testKeystore, keystore: 'sdfsdfsdfdsfsfdsf' });
    expect(type).toBe(AndroidKeystoreType.Unknown);
  });
});

describe('validateKeystore', () => {
  it('validates a correctly formatted jks keystore', async () => {
    const keystoreWithType = getKeystoreWithType(testKeystore);
    expect(keystoreWithType.type).toBe(AndroidKeystoreType.Jks);
    expect(() => {
      validateKeystore(keystoreWithType);
    }).not.toThrow();
  });
  it('doesnt validate a jks keystore with wrong alias', async () => {
    const keystoreWithType = getKeystoreWithType({
      ...testKeystore,
      keyAlias: 'non-existent-alias',
    });
    expect(() => {
      validateKeystore(keystoreWithType);
    }).toThrow();
  });
  it('doesnt validate a jks keystore with wrong key password', async () => {
    const keystoreWithType = getKeystoreWithType({
      ...testKeystore,
      keyPassword: 'not-the-password',
    });
    expect(() => {
      validateKeystore(keystoreWithType);
    }).toThrow();
  });
  it('validates a correctly formatted pkcs 12 keystore', async () => {
    const keystoreWithType = getKeystoreWithType(testPKCS12Keystore);
    expect(keystoreWithType.type).toBe(AndroidKeystoreType.Pkcs12);
    expect(() => {
      validateKeystore(keystoreWithType);
    }).not.toThrow();
  });
  it('doesnt validate a PKCS 12 keystore with wrong alias', async () => {
    const keystoreWithType = getKeystoreWithType({
      ...testPKCS12Keystore,
      keyAlias: 'non-existent-alias',
    });
    expect(() => {
      validateKeystore(keystoreWithType);
    }).toThrow();
  });
  it('validates an PKCS 12 Keystore with an empty password', async () => {
    const keystoreWithType = getKeystoreWithType(testPKCS12EmptyPasswordKeystore);
    expect(keystoreWithType.type).toBe(AndroidKeystoreType.Pkcs12);
    expect(() => {
      validateKeystore(keystoreWithType);
    }).not.toThrow();
  });
});
