import { errors } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import { SpawnResult } from '@expo/turtle-spawn';

import { runFastlane } from '../../fastlane';
import Keychain from '../keychain';

jest.mock('../../fastlane');
const runFastlaneMock = jest.mocked(runFastlane);
const logger = createLogger({ name: 'test' });
const warn = jest.spyOn(logger, 'warn').mockImplementation();
let keychain: Keychain;
const options = {
  logger,
  certPath: '/test.p12',
  certPassword: 'certificate-password',
};
beforeEach(async () => {
  keychain = new Keychain();
  runFastlaneMock.mockResolvedValueOnce(result(''));
  await keychain.create({ logger });
  runFastlaneMock.mockClear();
});
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
  await keychain.importCertificate(options);
  expect(runFastlaneMock).toHaveBeenCalledWith([
    'run',
    'import_certificate',
    'certificate_path:/test.p12',
    'certificate_password:certificate-password',
    `keychain_path:${keychain.data.path}`,
    `keychain_password:${keychain.data.password}`,
  ]);
  expect(warn).not.toHaveBeenCalled();
});

it('reports native errors even when fastlane exits successfully', async () => {
  runFastlaneMock.mockResolvedValueOnce(
    result(
      'security: SecKeychainItemImport: MAC verification failed during PKCS12 import\nResult: true'
    )
  );
  await keychain.importCertificate(options);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ diagnosticCode: expect.any(String) }),
    expect.stringContaining('export format')
  );
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ diagnosticCode: expect.any(String) }),
    expect.stringContaining('SecKeychainItemImport')
  );
});

it('never forwards output, command arguments, private key data, or the original error', async () => {
  const secret = 'very-secret-password';
  const error = Object.assign(new Error(`fastlane certificate_password:${secret}`), {
    stdout: `private key data ${secret}`,
    stderr: `security: SecKeychainItemSetAccessWithPassword: ${secret}`,
  });
  runFastlaneMock.mockRejectedValueOnce(error);
  await expect(keychain.importCertificate(options)).rejects.toThrow(
    'Fastlane could not complete certificate import'
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ diagnosticCode: expect.any(String) }),
    expect.stringContaining('private key')
  );
});

it('handles process launch failures without captured output', async () => {
  runFastlaneMock.mockRejectedValueOnce(new Error('ENOENT'));
  await expect(keychain.importCertificate(options)).rejects.toThrow(
    'Fastlane could not complete certificate import'
  );
  expect(warn).not.toHaveBeenCalled();
});

it.each(['ENOENT', 'EACCES'])(
  'classifies a %s process launch failure as a system error',
  async code => {
    runFastlaneMock.mockRejectedValueOnce(Object.assign(new Error('secret command'), { code }));
    const error = await keychain.importCertificate(options).catch(error => error);
    expect(error).toBeInstanceOf(errors.SystemError);
    expect(error.trackingCode).toBe('IOS_CERTIFICATE_IMPORT_PROCESS_START_FAILED');
    expect(error.cause).toBeUndefined();
  }
);

it('preserves a safe message and diagnostic codes without claiming a user cause', async () => {
  runFastlaneMock.mockRejectedValueOnce(
    Object.assign(new Error('secret command'), {
      stderr: 'SecKeychainItemImport: MAC verification failed during PKCS12 import',
    })
  );
  const error = await keychain.importCertificate(options).catch(error => error);
  expect(error).toBeInstanceOf(errors.UserError);
  expect(error.errorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  expect(error.metadata.diagnosticCodes).toEqual([
    'PKCS12_MAC_VERIFICATION_FAILED',
    'CERTIFICATE_IMPORT_FAILED',
  ]);
  expect(error.toExternalExpoError().message).toContain(
    'Fastlane could not complete certificate import'
  );
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain('secret command');
});
