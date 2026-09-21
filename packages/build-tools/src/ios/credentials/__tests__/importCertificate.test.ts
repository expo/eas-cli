import { createLogger } from '@expo/logger';
import { SpawnResult } from '@expo/turtle-spawn';

import { runFastlane } from '../../fastlane';
import { runFastlaneImportCertificate } from '../importCertificate';

jest.mock('../../fastlane');
const runFastlaneMock = jest.mocked(runFastlane);
const logger = createLogger({ name: 'test' });
const warn = jest.spyOn(logger, 'warn').mockImplementation();
const options = {
  logger,
  certificatePath: '/test.p12',
  certificatePassword: 'certificate-password',
  keychainPath: '/test.keychain',
  keychainPassword: 'keychain-password',
};
const result = (stdout: string, stderr = ''): SpawnResult => ({
  stdout,
  stderr,
  output: [stdout, stderr],
  pid: 1,
  status: 0,
  signal: null,
});

it('runs the import with the certificate and keychain credentials, without streaming output', async () => {
  runFastlaneMock.mockResolvedValueOnce(result('Result: true'));
  await runFastlaneImportCertificate(options);
  expect(runFastlaneMock).toHaveBeenCalledWith([
    'run',
    'import_certificate',
    'certificate_path:/test.p12',
    'certificate_password:certificate-password',
    'keychain_path:/test.keychain',
    'keychain_password:keychain-password',
  ]);
  expect(warn).not.toHaveBeenCalled();
});

it('reports native errors even when fastlane exits successfully', async () => {
  runFastlaneMock.mockResolvedValueOnce(
    result(
      'security: SecKeychainItemImport: MAC verification failed during PKCS12 import\nResult: true'
    )
  );
  await runFastlaneImportCertificate(options);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('export format'));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('SecKeychainItemImport'));
});

it('never forwards output, command arguments, private key data, or the original error', async () => {
  const secret = 'very-secret-password';
  const error = Object.assign(new Error(`fastlane certificate_password:${secret}`), {
    stdout: `private key data ${secret}`,
    stderr: `security: SecKeychainItemSetAccessWithPassword: ${secret}`,
  });
  runFastlaneMock.mockRejectedValueOnce(error);
  await expect(runFastlaneImportCertificate(options)).rejects.toThrow(
    'Fastlane could not complete certificate import'
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('private key'));
});

it('handles process launch failures without captured output', async () => {
  runFastlaneMock.mockRejectedValueOnce(new Error('ENOENT'));
  await expect(runFastlaneImportCertificate(options)).rejects.toThrow(
    'Fastlane could not complete certificate import'
  );
  expect(warn).not.toHaveBeenCalled();
});
