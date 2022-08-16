import forge from 'node-forge';

import {
  testDistributionCertificateEmptyPasswordBase64,
  testPKCS12KeystoreEmptyPasswordBase64,
} from '../../../__tests__/fixtures-base64-data';
import { getCertData } from '../p12Certificate';

describe(getCertData, () => {
  it('does not throw if p12 file with empty password was created with keychain', async () => {
    expect(() => getCertData(testDistributionCertificateEmptyPasswordBase64, '')).not.toThrow();
  });
  it('does throw an error if p12 file with empty password was created with openssl', async () => {
    expect(() => getCertData(testPKCS12KeystoreEmptyPasswordBase64, '')).toThrow();
  });
});

describe('forge.pkcs12.pkcs12FromAsn1', () => {
  describe('when using p12 created from keychain', () => {
    it('throws if empty string is passed', async () => {
      const p12Der = forge.util.decode64(testDistributionCertificateEmptyPasswordBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1, '')).toThrow();
    });
    it('does not throw if password value is not specified', async () => {
      const p12Der = forge.util.decode64(testDistributionCertificateEmptyPasswordBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1)).not.toThrow();
    });
  });
  describe('when using p12 created with openssl', () => {
    it('does not throw if password is empty', async () => {
      const p12Der = forge.util.decode64(testPKCS12KeystoreEmptyPasswordBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1, '')).not.toThrow();
    });
    it('throws if password value is not specified', async () => {
      const p12Der = forge.util.decode64(testPKCS12KeystoreEmptyPasswordBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1)).toThrow();
    });
  });
});
