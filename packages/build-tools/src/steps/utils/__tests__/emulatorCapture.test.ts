import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import { type Server, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { installIsolatedNpmPackageAsync } from '../../../utils/installIsolatedNpmPackageAsync';
import {
  type EmulatorCapture,
  type EmulatorCaptureLaunch,
  clearEmulatorCaptureHandoffAsync,
  findAvailableConsolePortAsync,
  finishEmulatorCaptureAsync,
  installEmulatorCaptureAsync,
  parseExperimentalEmulatorCaptureVersionInput,
  prepareEmulatorCaptureLaunchAsync,
  readEmulatorCaptureHubEnvAsync,
} from '../emulatorCapture';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

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
const HUB = 'expo-device-hub@0.22.0-canary-20261106-c8cd772';
const mockedInstall = jest.mocked(installIsolatedNpmPackageAsync);
const mockedSpawn = jest.mocked(spawn);
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
    args: ['-port', serialId.replace('emulator-', '')],
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
  mockedSpawn.mockReset();
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
  const AGENT = 'node_modules/expo-emulator-capture/dist/linux-x64/libexpo_emulator_capture.so';

  /** The install puts the agent where the package's `paths` export says it is. */
  function mockInstalledAgent(): void {
    mockedInstall.mockImplementation(async ({ directory }) => {
      fs.mkdirSync(path.dirname(path.join(directory, AGENT)), { recursive: true });
      fs.writeFileSync(path.join(directory, AGENT), '');
    });
    mockedSpawn.mockImplementation((async (
      _command: string,
      _args: string[],
      options?: { cwd?: string }
    ) => ({
      stdout: path.join(options?.cwd ?? '', AGENT),
      stderr: '',
    })) as unknown as typeof spawn);
  }

  it('installs the package in its own directory and asks it for its agent library', async () => {
    setHost('linux', 'x64');
    mockInstalledAgent();
    const logger = createMockLogger();

    const capture = await installEmulatorCaptureAsync({ version: '0.1.0', env, logger });

    expect(mockedInstall).toHaveBeenCalledWith({
      packageSpec: 'expo-emulator-capture@0.1.0',
      directory: expect.stringMatching(/^\/tmp\/eas-test\/eas-emulator-capture-package-/),
      npmCacheUrl: 'https://npm-cache.example',
      pathEnv: '/usr/bin',
      logger,
      signal: expect.any(AbortSignal),
    });
    const { directory } = mockedInstall.mock.calls[0][0];
    expect(mockedSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        expect.stringContaining(`import { agentLibraryPath } from 'expo-emulator-capture/paths'`),
      ],
      { cwd: directory, env: { PATH: '/usr/bin' } }
    );
    expect(capture).toEqual({
      version: '0.1.0',
      library: path.join(directory, AGENT),
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

  it('returns null when the package has no paths export', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockResolvedValue(undefined);
    mockedSpawn.mockRejectedValue(new Error('ERR_PACKAGE_PATH_NOT_EXPORTED'));
    const logger = createMockLogger();

    await expect(installEmulatorCaptureAsync({ version: 'latest', env, logger })).resolves.toBe(
      null
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null when the agent library that the package names is missing', async () => {
    setHost('linux', 'x64');
    mockedInstall.mockResolvedValue(undefined);
    mockedSpawn.mockResolvedValue({ stdout: '/tmp/eas-test/missing.so', stderr: '' } as never);
    const logger = createMockLogger();

    await expect(installEmulatorCaptureAsync({ version: '0.1.0', env, logger })).resolves.toBe(
      null
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Could not install')
    );
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
      args: ['-port', String(port)],
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

describe(clearEmulatorCaptureHandoffAsync, () => {
  it('removes the record of an earlier emulator start', async () => {
    fs.mkdirSync(path.dirname(HANDOFF_PATH), { recursive: true });
    fs.writeFileSync(HANDOFF_PATH, '{}');

    await clearEmulatorCaptureHandoffAsync({
      logger: createMockLogger(),
      handoffPath: HANDOFF_PATH,
    });

    expect(fs.existsSync(HANDOFF_PATH)).toBe(false);
  });

  it('does nothing when there is no record', async () => {
    const logger = createMockLogger();

    await clearEmulatorCaptureHandoffAsync({ logger, handoffPath: HANDOFF_PATH });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe(readEmulatorCaptureHubEnvAsync, () => {
  const socketPath = path.join(SOCKET_DIRECTORY, 'emulator-5554.sock');
  const OFF = { EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '0' };

  function writeHandoff(handoff: unknown): void {
    fs.mkdirSync(path.dirname(HANDOFF_PATH), { recursive: true });
    fs.writeFileSync(HANDOFF_PATH, JSON.stringify(handoff));
  }

  async function readAsync(env: Record<string, string> = {}): Promise<{
    result: Record<string, string>;
    logger: ReturnType<typeof createMockLogger>;
  }> {
    const logger = createMockLogger();
    const result = await readEmulatorCaptureHubEnvAsync({
      env,
      logger,
      hubPackageSpec: HUB,
      handoffPath: HANDOFF_PATH,
    });
    return { result, logger };
  }

  it('turns the capture on for an agent whose socket is there', async () => {
    writeHandoff({ ...CAPTURE, serialId: 'emulator-5554' });
    answerAsSockets(socketPath);

    const { result, logger } = await readAsync();

    expect(result).toEqual({
      EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '1',
      EXPO_DEVICE_HUB_EMULATOR_CAPTURE_LIBRARY: LIBRARY,
      TMPDIR: TEMPORARY_DIRECTORY,
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(HUB));
  });

  it('turns the capture off without a handoff, so the Hub does not try to attach', async () => {
    const { result, logger } = await readAsync();

    expect(result).toEqual(OFF);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps a capture value from the job env when there is no handoff', async () => {
    const { result } = await readAsync({ EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '1' });

    expect(result).toEqual({});
  });

  it('turns the capture off when the socket is gone', async () => {
    writeHandoff({ ...CAPTURE, serialId: 'emulator-5554' });

    const { result, logger } = await readAsync();

    expect(result).toEqual(OFF);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(socketPath));
  });

  it('turns the capture off when the agent library is gone', async () => {
    writeHandoff({ ...CAPTURE, serialId: 'emulator-5554' });
    answerAsSockets(socketPath);
    fs.rmSync(LIBRARY);

    const { result, logger } = await readAsync();

    expect(result).toEqual(OFF);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(LIBRARY));
  });

  it('turns the capture off for a malformed handoff', async () => {
    writeHandoff({ version: '0.1.0' });

    const { result, logger } = await readAsync();

    expect(result).toEqual(OFF);
    expect(logger.warn).toHaveBeenCalled();
  });
});
