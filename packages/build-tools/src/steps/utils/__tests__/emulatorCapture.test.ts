import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs';
import { type Server, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { installIsolatedNpmPackageAsync } from '../../../utils/installIsolatedNpmPackageAsync';
import {
  type EmulatorCapture,
  type EmulatorCaptureLaunch,
  findAvailableConsolePortAsync,
  finishEmulatorCaptureAsync,
  installEmulatorCaptureAsync,
  parseExperimentalEmulatorCaptureVersionInput,
  prepareEmulatorCaptureLaunchAsync,
  readEmulatorCaptureHubEnvAsync,
} from '../emulatorCapture';

jest.mock('../../../utils/installIsolatedNpmPackageAsync', () => ({
  installIsolatedNpmPackageAsync: jest.fn(),
}));

const TEMPORARY_DIRECTORY = '/tmp/eas-test';
const SOCKET_DIRECTORY = path.join(TEMPORARY_DIRECTORY, 'expo-emulator-capture');
const HANDOFF_PATH = path.join(TEMPORARY_DIRECTORY, 'handoff.json');
const LIBRARY = '/tmp/eas-test/package/libexpo_emulator_capture.so';
const CAPTURE: EmulatorCapture = {
  version: '0.1.0',
  library: LIBRARY,
  temporaryDirectory: TEMPORARY_DIRECTORY,
};
const mockedInstall = jest.mocked(installIsolatedNpmPackageAsync);
const { platform, arch } = process;

function setHost(hostPlatform: NodeJS.Platform, hostArch: string): void {
  Object.defineProperty(process, 'platform', { value: hostPlatform });
  Object.defineProperty(process, 'arch', { value: hostArch });
}

/** The unit tests run on memfs, which has no sockets: these paths answer as sockets. */
function answerAsSockets(...socketPaths: string[]): void {
  const lstat = fs.promises.lstat.bind(fs.promises);
  jest
    .spyOn(fs.promises, 'lstat')
    .mockImplementation((async (target: fs.PathLike) =>
      socketPaths.includes(String(target))
        ? ({ isSocket: () => true } as fs.Stats)
        : await lstat(target)) as typeof fs.promises.lstat);
}

function createLaunch(serialId = 'emulator-5554'): EmulatorCaptureLaunch {
  return {
    serialId,
    args: ['-port', serialId.replace('emulator-', ''), '-gpu', 'lavapipe'],
    env: {},
    socketPath: path.join(SOCKET_DIRECTORY, `${serialId}.sock`),
    logPath: path.join(SOCKET_DIRECTORY, `${serialId}.log`),
  };
}

beforeEach(() => {
  jest.spyOn(os, 'tmpdir').mockReturnValue(TEMPORARY_DIRECTORY);
  fs.mkdirSync(path.dirname(LIBRARY), { recursive: true });
  fs.writeFileSync(LIBRARY, '');
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

  it.each(['^0.1.0', '../0.1.0', '0.1.0 ', '-0.1.0', 'a/b', 'x'.repeat(129), 1])(
    'rejects %p',
    value => {
      expect(() => parseExperimentalEmulatorCaptureVersionInput(value)).toThrow(UserError);
    }
  );
});

describe(installEmulatorCaptureAsync, () => {
  const env = { PATH: '/usr/bin', EAS_BUILD_NPM_CACHE_URL: 'https://npm-cache.example' };

  it('installs the package in its own directory and prepares the socket directory', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockImplementation(async ({ directory }) => {
      const agent = path.join(
        directory,
        'node_modules/expo-emulator-capture/dist/linux-x64/libexpo_emulator_capture.so'
      );
      fs.mkdirSync(path.dirname(agent), { recursive: true });
      fs.writeFileSync(agent, '');
    });
    const logger = createMockLogger();

    const capture = await installEmulatorCaptureAsync({ version: '0.1.0', env, logger });

    expect(mockedInstall).toHaveBeenCalledWith({
      packageSpec: 'expo-emulator-capture@0.1.0',
      directory: expect.stringMatching(/^\/tmp\/eas-test\/eas-emulator-capture-package-/),
      npmCacheUrl: 'https://npm-cache.example',
      pathEnv: '/usr/bin',
      logger,
    });
    const { directory } = mockedInstall.mock.calls[0][0];
    expect(capture).toEqual({
      version: '0.1.0',
      library: path.join(
        directory,
        'node_modules/expo-emulator-capture/dist/linux-x64/libexpo_emulator_capture.so'
      ),
      temporaryDirectory: TEMPORARY_DIRECTORY,
    });
    expect(fs.statSync(SOCKET_DIRECTORY).mode & 0o777).toBe(0o700);
  });

  it('returns null when the install fails', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockRejectedValue(new Error('npm error 404'));
    const logger = createMockLogger();

    await expect(installEmulatorCaptureAsync({ version: '0.1.0', env, logger })).resolves.toBe(
      null
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Could not install expo-emulator-capture@0.1.0')
    );
  });

  it('returns null when the package has no Linux agent', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockResolvedValue(undefined);
    const logger = createMockLogger();

    await expect(installEmulatorCaptureAsync({ version: '0.1.0', env, logger })).resolves.toBe(
      null
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null on a host that is not Linux x86-64', async () => {
    setHost('darwin', 'arm64');
    const logger = createMockLogger();

    await expect(installEmulatorCaptureAsync({ version: '0.1.0', env, logger })).resolves.toBe(
      null
    );
    expect(mockedInstall).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Linux x86-64'));
  });
});

describe(prepareEmulatorCaptureLaunchAsync, () => {
  it('names the socket by the console port and keeps an inherited preload', async () => {
    const launch = await prepareEmulatorCaptureLaunchAsync({
      capture: CAPTURE,
      env: { LD_PRELOAD: '/opt/other.so' },
    });

    const port = Number(launch.args[1]);
    expect(port % 2).toBe(0);
    expect(port).toBeGreaterThanOrEqual(5554);
    expect(port).toBeLessThanOrEqual(5584);
    expect(launch).toEqual({
      serialId: `emulator-${port}`,
      args: ['-port', String(port), '-gpu', 'lavapipe'],
      env: {
        LD_PRELOAD: `${LIBRARY}:/opt/other.so`,
        EXPO_EMULATOR_CAPTURE_SOCKET: path.join(SOCKET_DIRECTORY, `emulator-${port}.sock`),
        EXPO_EMULATOR_CAPTURE_LOG: path.join(SOCKET_DIRECTORY, `emulator-${port}.log`),
      },
      socketPath: path.join(SOCKET_DIRECTORY, `emulator-${port}.sock`),
      logPath: path.join(SOCKET_DIRECTORY, `emulator-${port}.log`),
    });
  });

  it('preloads only the agent when the job preloads nothing', async () => {
    const launch = await prepareEmulatorCaptureLaunchAsync({ capture: CAPTURE, env: {} });

    expect(launch.env.LD_PRELOAD).toBe(LIBRARY);
  });

  it('removes the socket and log of an earlier emulator on the port', async () => {
    fs.mkdirSync(SOCKET_DIRECTORY, { recursive: true, mode: 0o700 });
    for (let port = 5554; port <= 5584; port += 2) {
      fs.writeFileSync(path.join(SOCKET_DIRECTORY, `emulator-${port}.sock`), '');
      fs.writeFileSync(path.join(SOCKET_DIRECTORY, `emulator-${port}.log`), 'ready on ...\n');
    }

    const launch = await prepareEmulatorCaptureLaunchAsync({ capture: CAPTURE, env: {} });

    expect(fs.existsSync(launch.socketPath)).toBe(false);
    expect(fs.existsSync(launch.logPath)).toBe(false);
  });
});

describe(findAvailableConsolePortAsync, () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  it('skips a console port whose adb port is in use', async () => {
    const port = await findAvailableConsolePortAsync();
    const adbServer = createServer();
    server = adbServer;
    await new Promise<void>(resolve => adbServer.listen(port + 1, '127.0.0.1', resolve));

    const next = await findAvailableConsolePortAsync();

    expect(next).not.toBe(port);
    expect(next % 2).toBe(0);
  });
});

describe(finishEmulatorCaptureAsync, () => {
  beforeEach(() => {
    fs.mkdirSync(SOCKET_DIRECTORY, { recursive: true, mode: 0o700 });
  });

  it('records an emulator whose agent opened its socket', async () => {
    const launch = createLaunch();
    answerAsSockets(launch.socketPath);
    const logger = createMockLogger();

    await finishEmulatorCaptureAsync({
      capture: CAPTURE,
      launch,
      serialId: 'emulator-5554',
      logger,
      handoffPath: HANDOFF_PATH,
    });

    expect(JSON.parse(fs.readFileSync(HANDOFF_PATH, 'utf8'))).toEqual({
      ...CAPTURE,
      serialId: 'emulator-5554',
    });
    expect(fs.statSync(HANDOFF_PATH).mode & 0o777).toBe(0o600);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs the agent log and records nothing when the socket does not open', async () => {
    const launch = createLaunch();
    fs.writeFileSync(launch.logPath, 'capture disabled: the gfxstream renderer did not load\n');
    const logger = createMockLogger();

    await finishEmulatorCaptureAsync({
      capture: CAPTURE,
      launch,
      serialId: 'emulator-5554',
      logger,
      handoffPath: HANDOFF_PATH,
      socketTimeoutMs: 0,
    });

    expect(fs.existsSync(HANDOFF_PATH)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('capture disabled: the gfxstream renderer did not load')
    );
  });

  it('records nothing when the emulator runs on another serial', async () => {
    const launch = createLaunch();
    answerAsSockets(launch.socketPath);
    const logger = createMockLogger();

    await finishEmulatorCaptureAsync({
      capture: CAPTURE,
      launch,
      serialId: 'emulator-5560',
      logger,
      handoffPath: HANDOFF_PATH,
    });

    expect(fs.existsSync(HANDOFF_PATH)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('-port'));
  });
});

describe(readEmulatorCaptureHubEnvAsync, () => {
  const socketPath = path.join(SOCKET_DIRECTORY, 'emulator-5554.sock');

  function writeHandoff(handoff: unknown): void {
    fs.mkdirSync(path.dirname(HANDOFF_PATH), { recursive: true });
    fs.writeFileSync(HANDOFF_PATH, JSON.stringify(handoff));
  }

  it('returns the expo-device-hub environment for an answering agent', async () => {
    writeHandoff({ ...CAPTURE, serialId: 'emulator-5554' });
    answerAsSockets(socketPath);
    const logger = createMockLogger();

    await expect(
      readEmulatorCaptureHubEnvAsync({ logger, handoffPath: HANDOFF_PATH })
    ).resolves.toEqual({
      EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '1',
      EXPO_DEVICE_HUB_EMULATOR_CAPTURE_LIBRARY: LIBRARY,
      TMPDIR: TEMPORARY_DIRECTORY,
    });
  });

  it('returns null without a handoff', async () => {
    const logger = createMockLogger();

    await expect(
      readEmulatorCaptureHubEnvAsync({ logger, handoffPath: HANDOFF_PATH })
    ).resolves.toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null when the agent no longer answers', async () => {
    writeHandoff({ ...CAPTURE, serialId: 'emulator-5554' });
    const logger = createMockLogger();

    await expect(
      readEmulatorCaptureHubEnvAsync({ logger, handoffPath: HANDOFF_PATH })
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(socketPath));
  });

  it('returns null for a malformed handoff', async () => {
    writeHandoff({ version: '0.1.0' });
    const logger = createMockLogger();

    await expect(
      readEmulatorCaptureHubEnvAsync({ logger, handoffPath: HANDOFF_PATH })
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
