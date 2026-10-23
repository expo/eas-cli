import { errors } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import forge from 'node-forge';
import os from 'os';
import path from 'path';

import { ensureCertificateImportedAsync } from '../validateCertificate';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

jest.setTimeout(60000);

// Exercise the native command/output contract with disposable credentials only.
// Do not install a trusted root or change the user's trust settings.
(process.platform === 'darwin' ? describe : describe.skip)('native identity diagnostics', () => {
  let directory: string;
  let keychainPath: string;
  let certificate: forge.pki.Certificate;
  let keys: forge.pki.rsa.KeyPair;
  let issuerKeys: forge.pki.rsa.KeyPair;
  const password = 'disposable-test-keychain';

  beforeAll(() => {
    keys = forge.pki.rsa.generateKeyPair(2048);
    issuerKeys = forge.pki.rsa.generateKeyPair(2048);
  });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-identity-test-'));
    keychainPath = path.join(directory, 'test.keychain-db');
    await spawn('security', ['create-keychain', '-p', password, keychainPath]);
    await spawn('security', ['unlock-keychain', '-p', password, keychainPath]);
    certificate = forge.pki.createCertificate();
    certificate.publicKey = keys.publicKey;
    certificate.serialNumber = '01';
    certificate.validity.notBefore = new Date(Date.now() - 86400000);
    certificate.validity.notAfter = new Date(Date.now() + 86400000);
    certificate.setSubject([{ name: 'commonName', value: 'Disposable signing test' }]);
    certificate.setIssuer([{ name: 'commonName', value: 'Absent test issuer' }]);
    certificate.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', codeSigning: true },
    ]);
    certificate.sign(issuerKeys.privateKey, forge.md.sha256.create());
  });

  afterEach(async () => {
    try {
      await spawn('security', ['delete-keychain', keychainPath]);
    } finally {
      await fs.remove(directory);
    }
  });

  function fingerprint(): string {
    return forge.md.sha1
      .create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes())
      .digest()
      .toHex()
      .toUpperCase();
  }

  async function diagnose(): Promise<errors.UserError> {
    const result = await ensureCertificateImportedAsync({
      keychainPath,
      fingerprint: fingerprint(),
      teamId: 'TEST',
    }).catch(error => error);
    expect(result).toBeInstanceOf(errors.UserError);
    expect(result.message).toContain('Signing identity validation failed');
    expect(result.message).not.toContain("hasn't been imported successfully");
    return result;
  }

  async function importIdentity(): Promise<void> {
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
      algorithm: '3des',
    });
    const file = path.join(directory, 'identity.p12');
    await fs.writeFile(file, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
    await spawn('security', ['import', file, '-k', keychainPath, '-P', password]);
  }

  it('reports absent credentials in an empty keychain', async () => {
    const failure = await diagnose();
    expect(failure.metadata).toMatchObject({
      certificatePresent: false,
      identityPresent: false,
      codesigningValid: false,
      validIdentityQuerySucceeded: true,
      queryFailures: [],
    });
    expect(failure.message).toContain('did not find the expected certificate or identity');
  });

  it('reports a certificate without its matching private key identity', async () => {
    const file = path.join(directory, 'certificate.pem');
    await fs.writeFile(file, forge.pki.certificateToPem(certificate));
    await spawn('security', ['import', file, '-k', keychainPath]);
    const failure = await diagnose();
    expect(failure.metadata).toMatchObject({
      certificatePresent: true,
      identityPresent: false,
      codesigningValid: false,
      queryFailures: [],
    });
    expect(failure.message).toContain(
      'Check that the PKCS#12 file contains the matching private key'
    );
  });

  it('reports an imported identity with an absent issuer without blaming import', async () => {
    await importIdentity();
    const failure = await diagnose();
    expect(failure.metadata).toMatchObject({
      certificatePresent: true,
      identityPresent: true,
      codesigningValid: false,
      trustErrors: ['CSSMERR_TP_NOT_TRUSTED'],
      queryFailures: [],
    });
    expect(failure.message).toContain('repair the trust chain on the build machine');
  });

  it('reports an expired imported identity and directs users to check certificate dates', async () => {
    certificate.validity.notBefore = new Date(Date.now() - 2 * 86400000);
    certificate.validity.notAfter = new Date(Date.now() - 86400000);
    certificate.sign(issuerKeys.privateKey, forge.md.sha256.create());
    await importIdentity();
    const failure = await diagnose();
    expect(failure.metadata).toMatchObject({
      certificatePresent: true,
      identityPresent: true,
      codesigningValid: false,
      queryFailures: [],
    });
    expect(failure.message).toContain('Check certificate dates');
  });
});
