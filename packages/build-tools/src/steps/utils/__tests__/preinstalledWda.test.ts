import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { preparePreinstalledWdaAsync } from '../preinstalledWda';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const appiumHome = path.join(os.tmpdir(), 'owned-appium-home');
const outdir = path.join(appiumHome, 'preinstalled-wda');
const runner = path.join(outdir, 'WebDriverAgentRunner-Runner.app');
const logger = { info: jest.fn(), warn: jest.fn() };
const options = {
  runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  appiumHome,
  appiumBinPath: path.join(appiumHome, 'node_modules', '.bin', 'appium'),
  appiumEnv: { APPIUM_HOME: appiumHome },
  logger: logger as never,
};

it('downloads the driver-matched Simulator runner and retains its XCTest frameworks', async () => {
  jest.mocked(spawn).mockImplementation((async () => {
    await fs.promises.mkdir(path.join(runner, 'Frameworks', 'XCTest.framework'), {
      recursive: true,
    });
    return { stdout: '' };
  }) as never);

  await expect(preparePreinstalledWdaAsync(options)).resolves.toEqual({
    'appium:usePreinstalledWDA': true,
    'appium:prebuiltWDAPath': runner,
  });
  expect(spawn).toHaveBeenCalledWith(
    options.appiumBinPath,
    [
      'driver',
      'run',
      'xcuitest',
      'download-wda',
      '--',
      '--outdir',
      outdir,
      '--platform',
      'iOS',
      '--kind',
      'sim',
    ],
    expect.objectContaining({ env: options.appiumEnv, timeout: 60_000, killSignal: 'SIGKILL' })
  );
  expect(
    (await fs.promises.stat(path.join(runner, 'Frameworks', 'XCTest.framework'))).isDirectory()
  ).toBe(true);
});

it.each([
  undefined,
  'com.apple.CoreSimulator.SimRuntime.iOS-16-4',
  'com.apple.CoreSimulator.SimRuntime.tvOS-26-5',
])('keeps the existing startup for unsupported runtime %s', async runtimeIdentifier => {
  await expect(preparePreinstalledWdaAsync({ ...options, runtimeIdentifier })).resolves.toEqual({});
  expect(spawn).not.toHaveBeenCalled();
});

it('falls back after a failed download and removes only its own incomplete artifact', async () => {
  await fs.promises.mkdir(outdir, { recursive: true });
  const sibling = path.join(appiumHome, 'keep');
  await fs.promises.writeFile(sibling, 'keep');
  jest.mocked(spawn).mockRejectedValue(new Error('download unavailable'));

  await expect(preparePreinstalledWdaAsync(options)).resolves.toEqual({});
  await expect(fs.promises.stat(outdir)).rejects.toThrow();
  await expect(fs.promises.readFile(sibling, 'utf8')).resolves.toBe('keep');
  expect(logger.warn).toHaveBeenCalled();
});

it('does not enable preinstalled startup when the download produces no runner', async () => {
  jest.mocked(spawn).mockResolvedValue({ stdout: '' } as never);
  await expect(preparePreinstalledWdaAsync(options)).resolves.toEqual({});
});
