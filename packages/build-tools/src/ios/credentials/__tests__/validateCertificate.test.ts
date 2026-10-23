import { createLogger } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import Keychain from '../keychain';

jest.mock('@expo/turtle-spawn');
const spawnMock = jest.mocked(spawn);
const fingerprint = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const logger = createLogger({ name: 'test' });
const logError = jest.spyOn(logger, 'error').mockImplementation();
const options = { teamId: 'TEAM', fingerprint, logger };
const identity = `  1) ${fingerprint} "Private certificate name"`;

beforeEach(() => {
  spawnMock.mockReset();
  logError.mockReset();
});

function output(stdout: string, stderr = ''): void {
  spawnMock.mockResolvedValueOnce({
    stdout,
    stderr,
    output: [stdout, stderr],
    status: 0,
    signal: null,
  });
}

it.each([
  ['identity entry', identity, ''],
  ['fingerprint in a name', `1) ${'0'.repeat(40)} "${fingerprint}"`, ''],
  ['stderr output', '', identity],
])(
  'preserves the original success check for %s without running diagnostics',
  async (_, stdout, stderr) => {
    output(stdout, stderr);
    logError.mockImplementation(() => {
      throw new Error('logging failed');
    });
    await expect(new Keychain().ensureCertificateImported(options)).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  }
);

it('preserves a primary command failure without running diagnostics', async () => {
  const error = new Error('security failed');
  spawnMock.mockRejectedValueOnce(error);
  await expect(new Keychain().ensureCertificateImported(options)).rejects.toBe(error);
  expect(spawnMock).toHaveBeenCalledTimes(1);
  expect(logError).not.toHaveBeenCalled();
});

it('keeps failed diagnostic queries unknown without exposing their raw errors', async () => {
  output('');
  spawnMock.mockRejectedValue(new Error('private output'));
  const failure = await new Keychain().ensureCertificateImported(options).catch(error => error);
  expect(failure.message).toContain('Signing identity validation failed');
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ certificatePresent: null, identityPresent: null }),
    expect.any(String)
  );
  expect(JSON.stringify([failure.message, logError.mock.calls])).not.toContain('private output');
});

it('preserves the validation failure if diagnostic logging throws', async () => {
  output('');
  output('');
  output('');
  logError.mockImplementation(() => {
    throw new Error('logging failed');
  });
  await expect(new Keychain().ensureCertificateImported(options)).rejects.toThrow(
    `Signing identity validation failed for distribution certificate with fingerprint ${fingerprint}.`
  );
});

it('does not report an unrelated identity whose name contains the expected fingerprint', async () => {
  output('');
  output('');
  output(`1) ${'0'.repeat(40)} "${fingerprint}"`);
  await expect(new Keychain().ensureCertificateImported(options)).rejects.toThrow(
    'Read the certificate import logs'
  );
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ certificatePresent: false, identityPresent: false }),
    expect.any(String)
  );
  expect(JSON.stringify(logError.mock.calls)).not.toContain('Private certificate name');
});
