import fs from 'fs-extra';
import { vol } from 'memfs';

import { getFingerprint, getCommonName } from '../distributionCertificate';

import { distributionCertificate } from './fixtures';

describe('distributionCertificate module', () => {
  describe(getFingerprint, () => {
    it('calculates the certificate fingerprint', () => {
      const fingerprint = getFingerprint({
        dataBase64: distributionCertificate.dataBase64,
        password: distributionCertificate.password,
      });
      expect(fingerprint).toEqual(distributionCertificate.fingerprint);
    });

    it('should throw an error if the password is incorrect', () => {
      expect(() => {
        getFingerprint({
          dataBase64: distributionCertificate.dataBase64,
          password: 'incorrect',
        });
      }).toThrowError(/password.*invalid/);
    });
  });
  describe(getCommonName, () => {
    it('returns cert common name', async () => {
      vol.fromNestedJSON({ '/tmp': {} });
      const commonName = getCommonName({
        dataBase64: distributionCertificate.dataBase64,
        password: distributionCertificate.password,
      });
      await fs.writeFile('/tmp/a', commonName, 'utf-8');
      expect(commonName).toBe(distributionCertificate.commonName);
    });
  });
});
