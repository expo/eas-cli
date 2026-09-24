import { errors } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { ensureCertificateImportedAsync } from '../validateCertificate';

jest.mock('@expo/turtle-spawn');
const spawnMock = jest.mocked(spawn);
const fingerprint = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const logger = createLogger({ name: 'test' });
const logError = jest.spyOn(logger, 'error').mockImplementation();
const options = { keychainPath: '/test.keychain', teamId: 'TEAM', fingerprint, logger };
const identity = `  1) ${fingerprint} "Private certificate name"`;
function outputs(...values: (string | Error)[]): void {
  spawnMock.mockReset();
  for (const value of values) {
    if (value instanceof Error) {
      spawnMock.mockRejectedValueOnce(value);
    } else {
      spawnMock.mockResolvedValueOnce({
        stdout: value,
        stderr: '',
        output: [value],
        status: 0,
        signal: null,
      });
    }
  }
}

it('does not run diagnostic probes when the existing gate passes', async () => {
  outputs(identity);
  await ensureCertificateImportedAsync(options);
  expect(spawnMock).toHaveBeenCalledTimes(1);
  expect(logError).not.toHaveBeenCalled();
});

it('distinguishes an imported but untrusted identity without accepting it', async () => {
  outputs(
    '0 valid identities found',
    `SHA-1 hash: ${fingerprint}`,
    `${identity} (CSSMERR_TP_NOT_TRUSTED)`,
    '0 valid identities found'
  );
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('trust chain');
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({
      certificatePresent: true,
      identityPresent: true,
      codesigningValid: false,
      trustErrors: ['CSSMERR_TP_NOT_TRUSTED'],
    }),
    expect.any(String)
  );
  expect(JSON.stringify(logError.mock.calls)).not.toContain('Private certificate name');
});

it('distinguishes a certificate without a private key identity', async () => {
  outputs('', `SHA-1 hash: ${fingerprint}`, '', '');
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('matching private key');
});

it('reports an absent certificate and identity without claiming the password is wrong', async () => {
  outputs('', '', '', '');
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('export format');
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ certificatePresent: false, identityPresent: false }),
    expect.any(String)
  );
});

it('does not count a fingerprint in a certificate name as the expected identity', async () => {
  outputs('', '', `1) ${'0'.repeat(40)} "${fingerprint}"`, '');
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('did not find');
});

it('keeps diagnostic failures unknown and does not expose raw errors', async () => {
  outputs(
    '',
    new Error('private output'),
    new Error('private output'),
    new Error('private output')
  );
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('could not determine');
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({
      certificatePresent: null,
      identityPresent: null,
      codesigningValid: null,
    }),
    expect.any(String)
  );
  expect(JSON.stringify(logError.mock.calls)).not.toContain('private output');
});

it('reports a failed primary query separately from a missing identity', async () => {
  outputs(new Error('security failed'), '', '', '');
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow(
    'valid-identity query failed'
  );
});

it('does not let a passing codesigning probe bypass the existing gate', async () => {
  outputs('', `SHA-1 hash: ${fingerprint}`, identity, identity);
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('signing test');
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ codesigningValid: true }),
    expect.any(String)
  );
});

it('does not accept a fingerprint found only in the name of another valid identity', async () => {
  outputs(`1) ${'0'.repeat(40)} "${fingerprint}"`, '', '', '');
  await expect(ensureCertificateImportedAsync(options)).rejects.toThrow('did not find');
  expect(spawnMock).toHaveBeenCalledTimes(4);
});

it('matches fingerprints without case sensitivity', async () => {
  outputs(identity.toLowerCase());
  await expect(ensureCertificateImportedAsync(options)).resolves.toBeUndefined();
  expect(spawnMock).toHaveBeenCalledTimes(1);
});

it('preserves guidance in the external build error without retaining raw probe errors', async () => {
  outputs(
    '',
    new Error('private output'),
    new Error('private output'),
    new Error('private output')
  );
  const failure = await ensureCertificateImportedAsync(options).catch(error => error);
  expect(failure).toBeInstanceOf(errors.UserError);
  expect(failure.errorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  expect(failure.toExternalExpoError().message).toContain('could not determine');
  expect(failure.metadata.identityPresent).toBeNull();
  expect(failure.cause).toBeUndefined();
  expect(JSON.stringify(failure)).not.toContain('private output');
});

it('preserves safe query failure details in logs and the external error', async () => {
  outputs(
    Object.assign(new Error('private output'), { code: 'ENOENT' }),
    Object.assign(new Error('private output'), { status: 1, signal: null }),
    Object.assign(new Error('private output'), { status: null, signal: 'SIGTERM' }),
    Object.assign(new Error('private output'), {
      status: 'private output',
      signal: 'private output',
      code: 'private output',
    })
  );
  const failure = await ensureCertificateImportedAsync(options).catch(error => error);
  const queryFailures = [
    { query: 'validIdentity', exitStatus: null, signal: null, code: 'ENOENT' },
    { query: 'certificate', exitStatus: 1, signal: null, code: null },
    { query: 'identity', exitStatus: null, signal: 'SIGTERM', code: null },
    { query: 'codesigningIdentity', exitStatus: null, signal: null, code: null },
  ];
  expect(failure.metadata.queryFailures).toEqual(queryFailures);
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ queryFailures }),
    expect.stringContaining(JSON.stringify(queryFailures))
  );
  expect(JSON.stringify([failure, logError.mock.calls])).not.toContain('private output');
});
