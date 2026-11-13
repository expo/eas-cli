import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { installIsolatedNpmPackageAsync } from '../../../utils/installIsolatedNpmPackageAsync';
import {
  installEmulatorCaptureAsync,
  parseExperimentalEmulatorCaptureVersionInput,
} from '../emulatorCapture';

jest.mock('../../../utils/installIsolatedNpmPackageAsync', () => ({
  installIsolatedNpmPackageAsync: jest.fn(),
}));

const TEMPORARY_DIRECTORY = '/tmp/eas-test';
const AGENT = 'node_modules/expo-emulator-capture/dist/linux-x64/libexpo_emulator_capture.so';
const mockedInstall = jest.mocked(installIsolatedNpmPackageAsync);
const { platform, arch } = process;

function setHost(hostPlatform: NodeJS.Platform, hostArch: string): void {
  Object.defineProperty(process, 'platform', { value: hostPlatform });
  Object.defineProperty(process, 'arch', { value: hostArch });
}

beforeEach(() => {
  jest.spyOn(os, 'tmpdir').mockReturnValue(TEMPORARY_DIRECTORY);
  fs.mkdirSync(TEMPORARY_DIRECTORY, { recursive: true });
  mockedInstall.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  setHost(platform, arch);
});

describe(parseExperimentalEmulatorCaptureVersionInput, () => {
  it.each([undefined, null, ''])('turns the capture off for %p', value => {
    expect(parseExperimentalEmulatorCaptureVersionInput(value)).toBeUndefined();
  });

  it.each(['0.1.0', '0.1.0-canary-20261106-2b670aa', 'canary', 'latest'])('accepts %s', value => {
    expect(parseExperimentalEmulatorCaptureVersionInput(value)).toBe(value);
  });

  it.each([
    '^0.1.0',
    '../0.1.0',
    'npm:other-package@1.0.0',
    'file:/tmp/agent',
    '0.1.0 ',
    '-0.1.0',
    'x'.repeat(129),
    1,
  ])('rejects %p', value => {
    expect(() => parseExperimentalEmulatorCaptureVersionInput(value)).toThrow(UserError);
  });
});

describe(installEmulatorCaptureAsync, () => {
  const env = { PATH: '/usr/bin', EAS_BUILD_NPM_CACHE_URL: 'https://npm-cache.example' };

  it('installs the package in its own directory and returns its agent library', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockImplementation(async ({ directory }) => {
      fs.mkdirSync(path.dirname(path.join(directory, AGENT)), { recursive: true });
      fs.writeFileSync(path.join(directory, AGENT), '');
    });
    const logger = createMockLogger();

    const library = await installEmulatorCaptureAsync({ version: '0.1.0', env, logger });

    expect(mockedInstall).toHaveBeenCalledWith({
      packageSpec: 'expo-emulator-capture@0.1.0',
      directory: expect.stringMatching(/^\/tmp\/eas-test\/eas-emulator-capture-package-/),
      npmCacheUrl: 'https://npm-cache.example',
      pathEnv: '/usr/bin',
      logger,
      signal: expect.any(AbortSignal),
    });
    expect(library).toBe(path.join(mockedInstall.mock.calls[0][0].directory, AGENT));
  });

  it('returns undefined when the install fails', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockRejectedValue(new Error('npm error 404'));
    const logger = createMockLogger();

    await expect(
      installEmulatorCaptureAsync({ version: '0.1.0', env, logger })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Could not install expo-emulator-capture@0.1.0')
    );
  });

  it('returns undefined when the package has no Linux agent library', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockResolvedValue(undefined);
    const logger = createMockLogger();

    await expect(
      installEmulatorCaptureAsync({ version: 'latest', env, logger })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('expo-emulator-capture@latest has no Linux x86-64 agent at')
    );
  });

  it('returns undefined on a host that is not Linux x86-64', async () => {
    setHost('darwin', 'arm64');
    const logger = createMockLogger();

    await expect(
      installEmulatorCaptureAsync({ version: '0.1.0', env, logger })
    ).resolves.toBeUndefined();
    expect(mockedInstall).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Linux x86-64'));
  });
});
