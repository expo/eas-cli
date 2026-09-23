import { errors } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import { SpawnResult } from '@expo/turtle-spawn';

import { runFastlane } from '../../fastlane';
import Keychain from '../keychain';

jest.mock('../../fastlane');
const runFastlaneMock = jest.mocked(runFastlane);
const logger = createLogger({ name: 'test' });
const logError = jest.spyOn(logger, 'error').mockImplementation();
let keychain: Keychain;
const options = {
  logger,
  certPath: '/test.p12',
  certPassword: 'certificate-password',
};
const result = (stdout: string, stderr = ''): SpawnResult => ({
  stdout,
  stderr,
  output: [stdout, stderr],
  pid: 1,
  status: 0,
  signal: null,
});

beforeEach(async () => {
  keychain = new Keychain();
  runFastlaneMock.mockResolvedValueOnce(result(''));
  await keychain.create({ logger });
  runFastlaneMock.mockClear();
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
  expect(logError).not.toHaveBeenCalled();
});

describe.each(['success', 'failure'])('Fastlane %s', outcome => {
  it.each([
    {
      output: 'SecKeychainItemImport: MAC verification failed during PKCS12 import',
      codes: ['PKCS12_MAC_VERIFICATION_FAILED'],
    },
    {
      output: 'SecKeychainItemImport: Unknown format in import',
      codes: ['PKCS12_UNKNOWN_FORMAT'],
    },
    {
      output: 'SecKeychainItemImport: Some other error',
      codes: ['CERTIFICATE_IMPORT_FAILED'],
    },
    {
      output:
        'SecKeychainItemImport: Unknown format in import\nSecKeychainItemSetAccessWithPassword: Access denied',
      codes: ['PKCS12_UNKNOWN_FORMAT', 'PRIVATE_KEY_ACCESS_FAILED'],
    },
    {
      output:
        'seckeychainitemimport: unknown format in import\nSecKeychainItemImport: Some other error',
      codes: ['PKCS12_UNKNOWN_FORMAT', 'CERTIFICATE_IMPORT_FAILED'],
    },
  ])('reports only the applicable codes: $codes', async ({ output, codes }) => {
    if (outcome === 'success') {
      runFastlaneMock.mockResolvedValueOnce(result(output));
      await keychain.importCertificate(options);
    } else {
      runFastlaneMock.mockRejectedValueOnce(
        Object.assign(new Error('import failed'), {
          stderr: output,
        })
      );
      const failure = await keychain.importCertificate(options).catch(error => error);
      expect(failure.metadata.diagnosticCodes).toEqual(codes);
    }
    expect(logError.mock.calls.map(([fields]) => fields.diagnosticCode)).toEqual(codes);
  });
});

it('never forwards output, command arguments, private key data, or the original error', async () => {
  const secret = 'very-secret-password';
  const error = Object.assign(new Error(`fastlane certificate_password:${secret}`), {
    stdout: `private key data ${secret}`,
    stderr: `security: SecKeychainItemSetAccessWithPassword: ${secret}`,
  });
  runFastlaneMock.mockRejectedValueOnce(error);
  const failure = await keychain.importCertificate(options).catch(error => error);
  expect(failure).toBeInstanceOf(errors.UserError);
  expect(failure.errorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  expect(failure.metadata).toEqual({ diagnosticCodes: ['PRIVATE_KEY_ACCESS_FAILED'] });
  expect(failure.toExternalExpoError().message).toContain(
    'Fastlane could not complete certificate import'
  );
  expect(failure.cause).toBeUndefined();
  expect(JSON.stringify([failure, logError.mock.calls])).not.toContain(secret);
  expect(logError).toHaveBeenCalledWith(
    { diagnosticCode: 'PRIVATE_KEY_ACCESS_FAILED' },
    expect.stringContaining('private key')
  );
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

it.each([
  null,
  new Error('failure'),
  { stderr: 'SecKeychainItemImport: Unknown format in import' },
  Object.assign(new Error('failure'), { stdout: 123, stderr: {} }),
])('handles rejected values without usable process output: %p', async value => {
  runFastlaneMock.mockRejectedValueOnce(value);
  await expect(keychain.importCertificate(options)).rejects.toThrow(
    'Fastlane could not complete certificate import'
  );
  expect(logError).not.toHaveBeenCalled();
});
