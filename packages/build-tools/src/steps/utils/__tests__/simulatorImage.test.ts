import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  SIMULATOR_IMAGE_DIRECTORY,
  SIMULATOR_IMAGE_MANIFEST,
  claimImageSimulatorAsync,
  copyImageExpoGoAsync,
  getImagePackageAsync,
  getImagePackageExecutableAsync,
} from '../simulatorImage';

jest.mock('@expo/turtle-spawn');

const appPath = '/Users/expo/.expo/ios-simulator-app-cache/Expo-Go-57.0.9.tar.app';
const appUrl =
  'https://github.com/expo/expo-go-releases/releases/download/Expo-Go-57.0.9/Expo-Go-57.0.9.tar.gz';
const packagePath = `${SIMULATOR_IMAGE_DIRECTORY}/tools/agent-device/node_modules/agent-device`;
const udid = 'B0367AC2-2B04-4C67-B633-A0A2603588D5';
const logger = createMockLogger();
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const manifest = {
  schemaVersion: 1,
  expoGo: [{ version: '57.0.9', url: appUrl, path: appPath }],
  packages: [{ name: 'agent-device', version: '1.2.3', path: packagePath }],
};
const appInfo = {
  CFBundleIdentifier: 'host.exp.Exponent',
  CFBundleShortVersionString: '57.0.9',
  CFBundleSupportedPlatforms: ['iPhoneSimulator'],
  CFBundleExecutable: 'Exponent',
};

function mockOutput(value: unknown): void {
  jest.mocked(spawn).mockResolvedValue({
    stdout: JSON.stringify(value),
    stderr: '',
    status: 0,
    signal: null,
    output: [],
  });
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
  vol.fromJSON({
    [SIMULATOR_IMAGE_MANIFEST]: JSON.stringify(manifest),
    [path.join(appPath, 'Info.plist')]: 'validated through plutil',
    [path.join(appPath, 'Exponent')]: 'simulator executable',
    [path.join(packagePath, 'package.json')]: JSON.stringify({
      name: 'agent-device',
      version: '1.2.3',
      bin: './cli.js',
    }),
    [path.join(packagePath, 'cli.js')]: 'tool executable',
  });
  jest.mocked(fetch).mockReset();
  jest.mocked(spawn).mockReset();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  jest.restoreAllMocks();
});

it('uses the normal path on older images and Linux', async () => {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
  expect(
    await claimImageSimulatorAsync({ env: { DEVICE_RUN_SESSION_ID: 'session' }, logger })
  ).toBeNull();
  expect(await copyImageExpoGoAsync({ url: appUrl, logger })).toBeNull();
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
  await fs.promises.unlink(SIMULATOR_IMAGE_MANIFEST);
  expect(
    await claimImageSimulatorAsync({ env: { DEVICE_RUN_SESSION_ID: 'session' }, logger })
  ).toBeNull();
  expect(spawn).not.toHaveBeenCalled();
});

it('does not claim devices for ordinary build workflows', async () => {
  expect(await claimImageSimulatorAsync({ env: {}, logger })).toBeNull();
  expect(spawn).not.toHaveBeenCalled();
});

it('claims an explicitly selected device through the locked image helper', async () => {
  mockOutput({ udid });
  expect(
    await claimImageSimulatorAsync({
      deviceIdentifier: 'iPhone 17 Pro',
      env: { DEVICE_RUN_SESSION_ID: 'session' },
      logger,
    })
  ).toBe(udid);
  expect(spawn).toHaveBeenCalledWith(
    '/opt/homebrew/bin/python3',
    ['/usr/local/libexec/expo-sim-service/sim_service.py', 'claim', '--device', 'iPhone 17 Pro'],
    expect.any(Object)
  );
});

it('does not bypass a preparation failure, lock timeout, or corrupt image manifest', async () => {
  jest.mocked(spawn).mockRejectedValue(new Error('preparation lock timeout'));
  await expect(
    claimImageSimulatorAsync({ env: { DEVICE_RUN_SESSION_ID: 'session' }, logger })
  ).rejects.toThrow('lock timeout');
  await fs.promises.writeFile(SIMULATOR_IMAGE_MANIFEST, '{}');
  await expect(
    claimImageSimulatorAsync({ env: { DEVICE_RUN_SESSION_ID: 'session' }, logger })
  ).rejects.toThrow();
});

it('rejects malformed claim output', async () => {
  mockOutput({ udid: 'booted' });
  await expect(
    claimImageSimulatorAsync({ env: { DEVICE_RUN_SESSION_ID: 'session' }, logger })
  ).rejects.toThrow();
});

it('copies an exact-URL cached bundle to independent job storage without fetching', async () => {
  mockOutput(appInfo);
  const result = await copyImageExpoGoAsync({ url: appUrl, logger });
  expect(result).not.toBeNull();
  expect(result).not.toBe(appPath);
  expect(await fs.promises.readFile(path.join(result!, 'Exponent'), 'utf8')).toBe(
    'simulator executable'
  );
  await fs.promises.writeFile(path.join(result!, 'Exponent'), 'job mutation');
  expect(await fs.promises.readFile(path.join(appPath, 'Exponent'), 'utf8')).toBe(
    'simulator executable'
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('misses the cache for another origin or patch release', async () => {
  expect(
    await copyImageExpoGoAsync({ url: appUrl.replace('github.com', 'example.com'), logger })
  ).toBeNull();
  expect(
    await copyImageExpoGoAsync({ url: appUrl.replaceAll('57.0.9', '57.0.10'), logger })
  ).toBeNull();
  expect(spawn).not.toHaveBeenCalled();
});

it('falls back for a missing executable or mismatched bundle', async () => {
  mockOutput({ ...appInfo, CFBundleShortVersionString: '57.0.8' });
  expect(await copyImageExpoGoAsync({ url: appUrl, logger })).toBeNull();
  mockOutput(appInfo);
  await fs.promises.unlink(path.join(appPath, 'Exponent'));
  expect(await copyImageExpoGoAsync({ url: appUrl, logger })).toBeNull();
});

it('uses an exact pinned tool version without network access', async () => {
  expect(await getImagePackageAsync({ name: 'agent-device', version: '1.2.3', logger })).toBe(
    packagePath
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('resolves latest before using the matching baked tool', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ name: 'agent-device', version: '1.2.3' }),
  } as any);
  expect(await getImagePackageAsync({ name: 'agent-device', logger })).toBe(packagePath);
  expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/agent-device/latest', {
    timeout: 10_000,
  });
});

it('never substitutes a stale baked version for latest', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ name: 'agent-device', version: '1.2.4' }),
  } as any);
  expect(await getImagePackageAsync({ name: 'agent-device', logger })).toBeNull();
});

it('falls back to existing installation when npm metadata fails', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  expect(await getImagePackageAsync({ name: 'agent-device', logger })).toBeNull();
  jest.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as any);
  expect(await getImagePackageAsync({ name: 'agent-device', logger })).toBeNull();
});

it('keeps normal resolution for ranges and missing packages', async () => {
  expect(
    await getImagePackageAsync({ name: 'agent-device', version: '^1.2.0', logger })
  ).toBeNull();
  expect(await getImagePackageAsync({ name: 'missing', logger })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('validates the installed package and its executable', async () => {
  const options = { name: 'agent-device', version: '1.2.3', binaryName: 'agent-device', logger };
  await fs.promises.chmod(path.join(packagePath, 'cli.js'), 0o755);
  expect(await getImagePackageExecutableAsync(options)).toBe(path.join(packagePath, 'cli.js'));
  await fs.promises.writeFile(
    path.join(packagePath, 'package.json'),
    JSON.stringify({ name: 'agent-device', version: '1.2.2' })
  );
  expect(await getImagePackageExecutableAsync(options)).toBeNull();
});
