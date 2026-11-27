import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { type Server, Socket, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../__tests__/utils/logger';
import { Sentry } from '../../sentry';
import {
  AndroidDeviceName,
  AndroidEmulatorExitedError,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../AndroidEmulatorUtils';
import { retryAsync } from '../retry';
import { AndroidEmulatorLogRing } from '../androidEmulatorLogCapture';
import { AndroidEmulatorLogFiles } from '../androidEmulatorLogFiles';
import {
  ALL_ANDROID_EMULATOR_LOG_SOURCES,
  AndroidEmulatorLogSourcesSchema,
} from '../androidEmulatorLogSources';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(async fn => await fn(0)),
}));

jest.mock('../../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));

const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);

describe('AndroidEmulatorUtils', () => {
  let temporaryDirectories: string[] = [];
  let homeDirectory: string;

  beforeEach(async () => {
    homeDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-utils-home-'));
    temporaryDirectories = [homeDirectory];
    jest.mocked(Sentry.capture).mockReset();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedRetryAsync.mockImplementation(async fn => await fn(0));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.map(async temporaryDirectory => {
        await fs.promises.rm(temporaryDirectory, { force: true, recursive: true });
      })
    );
  });

  describe(AndroidEmulatorUtils.createAsync, () => {
    it('applies an explicit LCD configuration after screen scaling', async () => {
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const avdDirectory = `${homeDirectory}/.android/avd/${deviceName}.avd`;
      await fs.promises.mkdir(avdDirectory, { recursive: true });
      await fs.promises.writeFile(
        `${avdDirectory}/config.ini`,
        [
          'hw.ramSize=1536',
          'hw.lcd.height=2424',
          'hw.lcd.width=1080',
          'hw.lcd.density=420',
          'skin.path=pixel_9',
          'showDeviceFrame=yes',
        ].join('\n')
      );
      const avdManagerPromise = Promise.resolve({ stdout: '', stderr: '' }) as any;
      const write = jest.fn();
      const end = jest.fn();
      avdManagerPromise.child = { stdin: { write, end } };
      mockedSpawn.mockReturnValue(avdManagerPromise);
      const logger = createMockLogger();

      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage: 'system-images;android-35;default;x86_64',
        deviceIdentifier: 'medium_phone' as AndroidDeviceName,
        lcdWidth: 720,
        lcdHeight: 1600,
        lcdDensity: 262,
        env: {
          HOME: homeDirectory,
          ANDROID_EMULATOR_ADJUST_SCREEN: '1',
          ANDROID_EMULATOR_ADJUST_HEAP_SIZE: '0',
        },
        logger,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'avdmanager',
        [
          'create',
          'avd',
          '--name',
          deviceName,
          '--package',
          'system-images;android-35;default;x86_64',
          '--force',
          '--device',
          'medium_phone',
        ],
        { env: expect.any(Object), stdio: 'pipe' }
      );
      expect(write).toHaveBeenCalledWith('no');
      expect(end).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Setting scaled screen resolution: hw.lcd.height to 1270 and hw.lcd.width to 566.'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Setting screen resolution to 720x1600 and density to 262 ppi.'
      );
      await expect(fs.promises.readFile(`${avdDirectory}/config.ini`, 'utf8')).resolves.toBe(
        [
          'hw.ramSize=1536',
          'hw.lcd.height=2424',
          'hw.lcd.width=1080',
          'hw.lcd.density=420',
          'skin.path=pixel_9',
          'showDeviceFrame=yes',
          'hw.ramSize=4096',
          '',
          'hw.lcd.density=220',
          '',
          'hw.lcd.height=1270',
          'hw.lcd.width=566',
          '',
          'hw.lcd.height=1600',
          'hw.lcd.width=720',
          'hw.lcd.density=262',
          '',
        ].join('\n')
      );
    });

    it.each([
      [undefined, 2048],
      ['device-run-session-id', 4096],
    ])('configures memory for session %s without an LCD override', async (sessionId, ramSize) => {
      const deviceName = 'generic-emulator' as AndroidVirtualDeviceName;
      const avdDirectory = `${homeDirectory}/.android/avd/${deviceName}.avd`;
      const initialConfig = ['skin.path=pixel_9', 'showDeviceFrame=yes'].join('\n');
      await fs.promises.mkdir(avdDirectory, { recursive: true });
      await fs.promises.writeFile(`${avdDirectory}/config.ini`, initialConfig);
      const avdManagerPromise = Promise.resolve({ stdout: '', stderr: '' }) as any;
      avdManagerPromise.child = { stdin: { write: jest.fn(), end: jest.fn() } };
      mockedSpawn.mockReturnValue(avdManagerPromise);

      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
        deviceIdentifier: null,
        lcdWidth: null,
        lcdHeight: null,
        lcdDensity: null,
        env: {
          HOME: homeDirectory,
          ANDROID_EMULATOR_ADJUST_HEAP_SIZE: '0',
          DEVICE_RUN_SESSION_ID: sessionId,
        },
        logger: createMockLogger(),
      });

      const config = await fs.promises.readFile(`${avdDirectory}/config.ini`, 'utf8');
      expect(config).toContain(initialConfig);
      expect(config).toContain(`hw.ramSize=${ramSize}\n`);
      expect(config).not.toContain('hw.lcd.');
    });

    it('throws UserError when avdmanager reports an invalid system image package path', async () => {
      const avdError = Object.assign(new Error('avdmanager exited with non-zero code: 1'), {
        stdout: '',
        stderr: 'Error: Package path is not valid. Valid system image paths are:\nnull\n',
        status: 1,
      });
      const avdManagerPromise = Promise.reject(avdError) as any;
      avdManagerPromise.child = { stdin: { write: jest.fn(), end: jest.fn() } };
      mockedSpawn.mockReturnValue(avdManagerPromise);

      const error = await AndroidEmulatorUtils.createAsync({
        deviceName: 'eas-simulator' as AndroidVirtualDeviceName,
        systemImagePackage: 'system-images;android-37;google_apis_playstore;x86_64',
        deviceIdentifier: null,
        lcdWidth: null,
        lcdHeight: null,
        lcdDensity: null,
        env: { HOME: homeDirectory },
        logger: createMockLogger(),
      }).catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND');
    });
  });

  describe(AndroidEmulatorUtils.startAsync, () => {
    let buildCapture: AndroidEmulatorLogFiles;
    beforeEach(() => {
      buildCapture = new AndroidEmulatorLogFiles({ sources: ALL_ANDROID_EMULATOR_LOG_SOURCES });
    });
    afterEach(async () => {
      await buildCapture.finishAsync();
    });

    async function logFile(directory: string, source: 'logcat' | 'emulator'): Promise<string> {
      const filename = (await fs.promises.readdir(directory)).find(file =>
        file.endsWith(`-${source}.log`)
      );
      if (!filename) {
        throw new Error(`Missing ${source} log in ${directory}`);
      }
      return path.join(directory, filename);
    }

    function createMockEmulatorSpawn() {
      // Under `stdio: 'pipe'` these are net.Sockets, which is what startAsync
      // narrows on before unref-ing them.
      const stdout = new Socket();
      const stderr = new Socket();
      jest.spyOn(stdout, 'unref').mockReturnValue(stdout);
      jest.spyOn(stderr, 'unref').mockReturnValue(stderr);
      let resolveSpawn!: (value: { stdout: string; stderr: string; status?: number }) => void;
      let rejectSpawn!: (err: unknown) => void;
      const spawnPromise = new Promise((resolve, reject) => {
        resolveSpawn = resolve;
        rejectSpawn = reject;
      }) as any;
      const kill = jest.fn(() => {
        resolveSpawn({ stdout: '', stderr: '', status: 0 });
      });
      const child = Object.assign(new EventEmitter(), {
        pid: 1234,
        unref: jest.fn(),
        kill,
        stdout,
        stderr,
      });
      spawnPromise.child = child;
      return {
        child,
        spawnPromise,
        resolveSpawn,
        rejectSpawn,
        kill,
      };
    }

    function mockSuccessfulStart(deviceName: AndroidVirtualDeviceName) {
      const mock = createMockEmulatorSpawn();
      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          return mock.spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({ stdout: 'emulator-5554\tdevice\n', stderr: '' });
        }
        if (command === 'adb' && args[0] === '-s' && args[2] === 'emu') {
          return Promise.resolve({ stdout: `${deviceName}\nOK\n`, stderr: '' });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);
      return mock;
    }

    it('names log files after the device and detaches the emulator', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const { child } = mockSuccessfulStart(deviceName);

      await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env: process.env,
        logcatDirectory: outputDir,
      });
      child.emit('close');
      await buildCapture.finishAsync();

      expect(await logFile(outputDir, 'logcat')).toMatch(
        new RegExp(`^${outputDir}/eas-simulator-[a-f0-9]{8}-[a-f0-9]{4}-logcat\\.log$`)
      );
      expect(await logFile(outputDir, 'emulator')).toMatch(
        new RegExp(`^${outputDir}/eas-simulator-[a-f0-9]{8}-[a-f0-9]{4}-emulator\\.log$`)
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/\/emulator\/emulator$/),
        expect.any(Array),
        expect.objectContaining({ detached: true, ignoreStdio: true })
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        expect.arrayContaining(['logcat']),
        expect.anything()
      );
      expect(child.unref).toHaveBeenCalled();
      // Piped stdio would otherwise keep this process' event loop alive
      // for as long as the emulator runs.
      expect(child.stdout.unref).toHaveBeenCalled();
      expect(child.stderr.unref).toHaveBeenCalled();
    });

    it.each([
      { sources: [] },
      { sources: ['emulator-output'] },
      { sources: ['device-logcat'] },
      { sources: ['emulator-output', 'device-logcat'] },
    ])('records only $sources', async ({ sources }) => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'selected-logs-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'selected-emulator' as AndroidVirtualDeviceName;
      const { child } = mockSuccessfulStart(deviceName);
      const stdoutPipe = jest.spyOn(child.stdout, 'pipe');
      const stderrPipe = jest.spyOn(child.stderr, 'pipe');
      const capture = new AndroidEmulatorLogFiles({
        sources: AndroidEmulatorLogSourcesSchema.parse(sources),
      });
      const prepare = jest.spyOn(capture, 'prepareLogcatOutputAsync');
      await AndroidEmulatorUtils.startAsync({
        logCapture: capture,
        deviceName,
        env: {},
        logcatDirectory: outputDir,
      });
      const capturesOutput = sources.includes('emulator-output');
      const capturesLogcat = sources.includes('device-logcat');
      const [, args, options] = mockedSpawn.mock.calls[0];
      expect(prepare).toHaveBeenCalledTimes(capturesLogcat ? 1 : 0);
      expect(args.includes('-logcat')).toBe(capturesLogcat);
      expect(args.includes('-logcat-output')).toBe(capturesLogcat);
      expect(options?.stdio).toEqual([
        'ignore',
        capturesOutput ? 'pipe' : 'ignore',
        capturesOutput ? 'pipe' : 'ignore',
      ]);
      expect(stdoutPipe).toHaveBeenCalledTimes(capturesOutput ? 1 : 0);
      expect(stderrPipe).toHaveBeenCalledTimes(capturesOutput ? 1 : 0);
      if (capturesOutput) {
        child.stdout.emit('data', Buffer.from('stdout marker\n'));
        child.stderr.emit('data', Buffer.from('stderr marker\n'));
        child.emit('close');
      }
      await capture.finishAsync();
      if (capturesOutput) {
        await expect(
          fs.promises.readFile(await logFile(outputDir, 'emulator'), 'utf8')
        ).resolves.toBe('stdout marker\nstderr marker\n');
      }
      const files = await fs.promises.readdir(outputDir);
      expect(files).toHaveLength(sources.length);
      expect(files.some(file => file.endsWith('-logcat.log'))).toBe(capturesLogcat);
      expect(files.some(file => file.endsWith('-emulator.log'))).toBe(capturesOutput);
    });

    it('routes a session logcat through the capture pipe and closes it with the emulator', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bounded-logs-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'bounded-emulator' as AndroidVirtualDeviceName;
      const { child } = mockSuccessfulStart(deviceName);
      const capture = new AndroidEmulatorLogRing({ sources: ['device-logcat'] });
      const close = jest.fn();
      const createPipe = jest.spyOn(capture, 'prepareLogcatOutputAsync').mockResolvedValue({
        path: '/logcat.pipe',
        close,
        closed: Promise.resolve(),
      });
      await AndroidEmulatorUtils.startAsync({
        deviceName,
        env: {},
        logcatDirectory: outputDir,
        logCapture: capture,
      });
      expect(createPipe).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`^${outputDir}/bounded-emulator-[a-f0-9]{8}-[a-f0-9]{4}-logcat\\.log$`)
        )
      );
      expect(mockedSpawn.mock.calls[0][1]).toEqual(
        expect.arrayContaining(['-logcat-output', '/logcat.pipe'])
      );
      expect(close).not.toHaveBeenCalled();
      child.emit('close');
      await capture.finishAsync();
      expect(close).toHaveBeenCalledTimes(1);
      expect(await fs.promises.readdir(outputDir)).toEqual([]);
    });

    it('spawns the emulator directly with the same arguments when there is no launch gate', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      mockSuccessfulStart(deviceName);
      const env = { ANDROID_EMULATOR_EXTRA_ARGS: '-gpu swiftshader_indirect' };

      await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env,
        logcatDirectory: outputDir,
      });

      const emulatorCalls = mockedSpawn.mock.calls.filter(([command]) =>
        command.endsWith('/emulator/emulator')
      );
      expect(emulatorCalls).toEqual([
        [
          `${process.env.ANDROID_HOME}/emulator/emulator`,
          [
            '-no-window',
            '-no-boot-anim',
            '-writable-system',
            '-noaudio',
            '-no-snapshot-save',
            '-logcat',
            '*:v',
            '-logcat-output',
            await logFile(outputDir, 'logcat'),
            '-avd',
            deviceName,
            '-accel',
            'on',
            '-gpu',
            'swiftshader_indirect',
          ],
          {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            ignoreStdio: true,
            env: { ...env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
          },
        ],
      ]);
      expect(
        mockedSpawn.mock.calls.filter(([command]) =>
          ['sudo', 'nft', 'systemd-run', 'bash'].includes(command)
        )
      ).toEqual([]);
    });

    it('adds the console port before $ANDROID_EMULATOR_EXTRA_ARGS', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      mockSuccessfulStart(deviceName);
      const env = { ANDROID_EMULATOR_EXTRA_ARGS: '-gpu swiftshader_indirect' };

      await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env,
        logcatDirectory: outputDir,
        consolePort: 5556,
        extraEnv: { LD_PRELOAD: '/tmp/libexpo_emulator_capture.so' },
      });

      const [, args, options] = mockedSpawn.mock.calls.find(([command]) =>
        command.endsWith('/emulator/emulator')
      )!;
      expect(args.slice(-6)).toEqual([
        '-accel',
        'on',
        '-port',
        '5556',
        '-gpu',
        'swiftshader_indirect',
      ]);
      expect(options?.env).toEqual({
        ...env,
        LD_PRELOAD: '/tmp/libexpo_emulator_capture.so',
        ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1',
      });
    });

    it('starts the emulator behind the launch gate and releases it once admitted', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const { child } = mockSuccessfulStart(deviceName);
      const stdin = { end: jest.fn() };
      Object.assign(child, { stdin });
      const gatedSpawn = mockedSpawn.getMockImplementation()!;
      mockedSpawn.mockImplementation(((command: string, args: string[], options: object) =>
        command === 'bash'
          ? gatedSpawn('/android/emulator/emulator', args, options as any)
          : gatedSpawn(command, args, options as any)) as any);
      const admitAsync = jest.fn().mockResolvedValue(undefined);

      await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env: {},
        logcatDirectory: outputDir,
        launchGate: {
          emulatorArgs: ['-http-proxy', '127.0.0.1:8898', '-no-metrics'],
          wrapperCommand: 'bash',
          wrapperArgs: ['-c', 'gate', 'eas-egress-gate'],
          admitAsync,
        },
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'bash',
        [
          '-c',
          'gate',
          'eas-egress-gate',
          `${process.env.ANDROID_HOME}/emulator/emulator`,
          '-no-window',
          '-no-boot-anim',
          '-writable-system',
          '-noaudio',
          '-no-snapshot-save',
          '-logcat',
          '*:v',
          '-logcat-output',
          await logFile(outputDir, 'logcat'),
          '-avd',
          deviceName,
          '-accel',
          'on',
          '-http-proxy',
          '127.0.0.1:8898',
          '-no-metrics',
        ],
        expect.objectContaining({ detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(admitAsync).toHaveBeenCalledWith(1234);
      expect(stdin.end).toHaveBeenCalledWith('go\n');
      expect(admitAsync.mock.invocationCallOrder[0]).toBeLessThan(
        stdin.end.mock.invocationCallOrder[0]
      );
    });

    it('kills the gated wrapper and throws when admission fails', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const { child, kill } = mockSuccessfulStart(deviceName);
      const stdin = { end: jest.fn() };
      Object.assign(child, { stdin });
      const gatedSpawn = mockedSpawn.getMockImplementation()!;
      mockedSpawn.mockImplementation(((command: string, args: string[], options: object) =>
        gatedSpawn(
          command === 'bash' ? '/android/emulator/emulator' : command,
          args,
          options as any
        )) as any);
      const admissionError = new Error('not fenced');

      await expect(
        AndroidEmulatorUtils.startAsync({
          logCapture: buildCapture,
          deviceName,
          env: {},
          logcatDirectory: outputDir,
          launchGate: {
            emulatorArgs: [],
            wrapperCommand: 'bash',
            wrapperArgs: ['-c', 'gate', 'eas-egress-gate'],
            admitAsync: jest.fn().mockRejectedValue(admissionError),
          },
        })
      ).rejects.toBe(admissionError);
      expect(kill).toHaveBeenCalledWith('SIGKILL');
      expect(stdin.end).not.toHaveBeenCalled();
    });

    it('fails fast with emulator stderr tail when emulator exits before registering with adb', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'crashing-emulator' as AndroidVirtualDeviceName;
      const { child, spawnPromise, rejectSpawn } = createMockEmulatorSpawn();

      mockedRetryAsync.mockImplementation(async (fn, { retryOptions, shouldRetry, signal }) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= retryOptions.retries; attempt++) {
          if (signal?.aborted) {
            throw lastErr ?? new Error('aborted');
          }
          try {
            return await fn(attempt);
          } catch (err) {
            lastErr = err;
            if (shouldRetry && !shouldRetry(err)) {
              throw err;
            }
          }
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        throw lastErr;
      });

      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          setImmediate(() => {
            child.stderr.emit(
              'data',
              Buffer.from(
                'ERROR | Running multiple emulators\nFATAL | Unsupported 16k page image\n'
              )
            );
            rejectSpawn(
              Object.assign(new Error('emulator exited with non-zero code: 1'), {
                status: 1,
                signal: null,
              })
            );
            child.emit('close');
          });
          return spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({ stdout: 'List of devices attached\n\n', stderr: '' });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);

      const error = await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env: process.env,
        logcatDirectory: outputDir,
      }).catch(err => err);

      expect(error).toBeInstanceOf(AndroidEmulatorExitedError);
      expect(error.exitCode).toBe(1);
      expect(error.isRetryable).toBe(true);
      expect(error.message).toContain('exited prematurely during startup with exit code 1');
      expect(error.message).toContain('FATAL | Unsupported 16k page image');
      const adbCalls = mockedSpawn.mock.calls.filter(([cmd]) => cmd === 'adb');
      expect(adbCalls.length).toBeLessThanOrEqual(1);
    });

    it('marks deterministic fatal emulator crashes as non-retryable', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'kvm-failed-emulator' as AndroidVirtualDeviceName;
      const { child, spawnPromise, rejectSpawn } = createMockEmulatorSpawn();

      mockedSpawn.mockImplementation(((command: string) => {
        if (command.endsWith('/emulator/emulator')) {
          queueMicrotask(() => {
            child.stderr.emit('data', Buffer.from('ERROR | KVM is required to run this AVD.\n'));
            rejectSpawn(
              Object.assign(new Error('emulator exited with non-zero code: 1'), {
                status: 1,
                signal: null,
              })
            );
            child.emit('close');
          });
          return spawnPromise;
        }
        return Promise.resolve({ stdout: 'List of devices attached\n\n', stderr: '' });
      }) as any);

      const error = await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env: process.env,
        logcatDirectory: outputDir,
      }).catch(err => err);

      expect(error).toBeInstanceOf(AndroidEmulatorExitedError);
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain('KVM is required to run this AVD.');
      expect(mockedSpawn.mock.calls.filter(([cmd]) => cmd === 'adb').length).toBeLessThanOrEqual(1);
    });

    it('surfaces emulator output tail and kills the process when startAsync times out while alive', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'hung-emulator' as AndroidVirtualDeviceName;
      const { child, spawnPromise, kill } = createMockEmulatorSpawn();

      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          setImmediate(() => {
            child.stdout.emit('data', Buffer.from('INFO | Waiting for guest kernel\n'));
          });
          return spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return new Promise(resolve => {
            setImmediate(() => resolve({ stdout: 'List of devices attached\n\n', stderr: '' }));
          });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);

      const error = await AndroidEmulatorUtils.startAsync({
        logCapture: buildCapture,
        deviceName,
        env: process.env,
        logcatDirectory: outputDir,
      }).catch(err => err);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AndroidEmulatorExitedError);
      expect(error.message).toContain('emulator with required ID not found');
      expect(error.message).toContain('INFO | Waiting for guest kernel');
      expect(kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('throws a SystemError when the staging directory cannot be prepared', async () => {
      const outputDir = '/unwritable/logcat-staging';
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const mkdirError = new Error('mkdir failed');
      const mkdirSpy = jest.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(mkdirError);

      try {
        await expect(
          AndroidEmulatorUtils.startAsync({
            logCapture: buildCapture,
            deviceName,
            env: process.env,
            logcatDirectory: outputDir,
          })
        ).rejects.toEqual(
          new SystemError('Failed to prepare Android emulator output for eas-simulator.', {
            cause: mkdirError,
          })
        );
        expect(mockedSpawn).not.toHaveBeenCalled();
      } finally {
        mkdirSpy.mockRestore();
      }
    });
  });

  describe(AndroidEmulatorUtils.findFreeConsolePortAsync, () => {
    /** Listens on the port, or returns null when another process already uses it. */
    async function occupyAsync(port: number): Promise<Server | null> {
      const server = createServer();
      return await new Promise(resolve => {
        server.once('error', () => resolve(null));
        server.listen(port, '127.0.0.1', () => resolve(server));
      });
    }

    async function closeAsync(servers: (Server | null)[]): Promise<void> {
      await Promise.all(
        servers.map(server => (server ? new Promise(resolve => server.close(resolve)) : null))
      );
    }

    it('returns an even console port that adb scans', async () => {
      const port = await AndroidEmulatorUtils.findFreeConsolePortAsync();

      expect(port % 2).toBe(0);
      expect(port).toBeGreaterThanOrEqual(5554);
      expect(port).toBeLessThanOrEqual(5584);
    });

    it('skips a console port whose adb port is in use', async () => {
      const port = await AndroidEmulatorUtils.findFreeConsolePortAsync();
      const adbServer = await occupyAsync(port + 1);
      try {
        expect(adbServer).not.toBeNull();
        const next = await AndroidEmulatorUtils.findFreeConsolePortAsync();

        expect(next).not.toBe(port);
        expect(next % 2).toBe(0);
      } finally {
        await closeAsync([adbServer]);
      }
    });

    it('throws when no console port is free', async () => {
      const servers: (Server | null)[] = [];
      try {
        for (let port = 5555; port <= 5585; port += 2) {
          servers.push(await occupyAsync(port));
        }

        await expect(AndroidEmulatorUtils.findFreeConsolePortAsync()).rejects.toThrow(
          'No emulator console port from 5554 to 5584 is free.'
        );
      } finally {
        await closeAsync(servers);
      }
    });
  });

  describe(AndroidEmulatorUtils.waitForReadyAsync, () => {
    it('checks boot completion and verifies network with netcat to 1.1.1.1:443', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'nc' && args[6] === '1.1.1.1' && args[7] === '443') {
          return { stdout: '', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
        timeoutMs: 60_000,
      });

      expect(mockedRetryAsync).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          retryOptions: expect.objectContaining({
            retries: 59,
            retryIntervalMs: 1_000,
          }),
        })
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'nc', '-w', '1', '1.1.1.1', '443'],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    });

    it('throws when network is unavailable despite completed boot', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'nc') {
          throw new Error('network unreachable');
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await expect(
        AndroidEmulatorUtils.waitForReadyAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
        })
      ).rejects.toThrow('network is not ready');
    });

    it('checks the given readiness target instead of 1.1.1.1:443', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'nc' && args[6] === '192.0.2.1' && args[7] === '443') {
          return { stdout: '', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
        networkReadyTarget: { host: '192.0.2.1', port: 443 },
      });

      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        expect.arrayContaining(['1.1.1.1']),
        expect.anything()
      );
    });

    it('uses overridden network readiness command when provided', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'exit 0') {
          return { stdout: '', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: 'emulator-5554' as any,
        env: {
          ...process.env,
          ANDROID_EMULATOR_NETWORK_READY_COMMAND: 'exit 0',
        },
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'exit 0'],
        expect.objectContaining({
          env: expect.objectContaining({
            ANDROID_EMULATOR_NETWORK_READY_COMMAND: 'exit 0',
          }),
        })
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'nc', '-w', '1', '1.1.1.1', '443'],
        expect.anything()
      );
    });

    it('fails fast with captured emulator output when the emulator exits during waitForReadyAsync', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const buildCapture = new AndroidEmulatorLogFiles({
        sources: ALL_ANDROID_EMULATOR_LOG_SOURCES,
      });
      const deviceName = 'boot-crash-emulator' as AndroidVirtualDeviceName;
      const stdout = new Socket();
      const stderr = new Socket();
      jest.spyOn(stdout, 'unref').mockReturnValue(stdout);
      jest.spyOn(stderr, 'unref').mockReturnValue(stderr);
      let rejectSpawn!: (err: unknown) => void;
      const spawnPromise = new Promise((_resolve, reject) => {
        rejectSpawn = reject;
      }) as any;
      const child = Object.assign(new EventEmitter(), {
        pid: 4321,
        unref: jest.fn(),
        kill: jest.fn(),
        stdout,
        stderr,
      });
      spawnPromise.child = child;

      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          return spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({ stdout: 'emulator-5554\tdevice\n', stderr: '' });
        }
        if (command === 'adb' && args[0] === '-s' && args[2] === 'emu') {
          return Promise.resolve({ stdout: `${deviceName}\nOK\n`, stderr: '' });
        }
        if (command === 'adb' && args[3] === 'getprop') {
          child.stderr.emit('data', Buffer.from('ERROR | Guest kernel panic on ps16k image\n'));
          rejectSpawn(
            Object.assign(new Error('emulator exited with signal: SIGABRT'), {
              status: null,
              signal: 'SIGABRT',
            })
          );
          child.emit('close');
          return Promise.reject(
            new Error(
              'adb -s emulator-5554 shell getprop sys.boot_completed exited with non-zero code: 1'
            )
          );
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);

      try {
        const { serialId, emulatorPromise } = await AndroidEmulatorUtils.startAsync({
          logCapture: buildCapture,
          deviceName,
          env: process.env,
          logcatDirectory: outputDir,
        });

        const error = await AndroidEmulatorUtils.waitForReadyAsync({
          serialId,
          env: process.env,
          timeoutMs: 60_000,
          emulatorPromise,
        }).catch(err => err);

        expect(error).toBeInstanceOf(AndroidEmulatorExitedError);
        expect(error.signal).toBe('SIGABRT');
        expect(error.message).toContain('exited prematurely during startup with signal SIGABRT');
        expect(error.message).toContain('ERROR | Guest kernel panic on ps16k image');
      } finally {
        await buildCapture.finishAsync();
      }
    });

    it('surfaces captured emulator output on timeout and detaches startup listeners when ready', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const buildCapture = new AndroidEmulatorLogFiles({
        sources: ALL_ANDROID_EMULATOR_LOG_SOURCES,
      });
      const deviceName = 'slow-emulator' as AndroidVirtualDeviceName;
      const stdout = new Socket();
      const stderr = new Socket();
      jest.spyOn(stdout, 'unref').mockReturnValue(stdout);
      jest.spyOn(stderr, 'unref').mockReturnValue(stderr);
      const spawnPromise = new Promise(() => {}) as any;
      const child = Object.assign(new EventEmitter(), {
        pid: 4322,
        unref: jest.fn(),
        kill: jest.fn(),
        stdout,
        stderr,
      });
      spawnPromise.child = child;

      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          return spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({ stdout: 'emulator-5554\tdevice\n', stderr: '' });
        }
        if (command === 'adb' && args[0] === '-s' && args[2] === 'emu') {
          return Promise.resolve({ stdout: `${deviceName}\nOK\n`, stderr: '' });
        }
        if (command === 'adb' && args[3] === 'getprop') {
          child.stderr.emit(
            'data',
            Buffer.from('WARNING | Boot stalled waiting for system_server\n')
          );
          return Promise.reject(
            new Error(
              'adb -s emulator-5554 shell getprop sys.boot_completed exited with non-zero code: 1'
            )
          );
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);

      try {
        const { serialId, emulatorPromise } = await AndroidEmulatorUtils.startAsync({
          logCapture: buildCapture,
          deviceName,
          env: process.env,
          logcatDirectory: outputDir,
        });
        const stderrListenersBefore = child.stderr.listenerCount('data');

        const error = await AndroidEmulatorUtils.waitForReadyAsync({
          serialId,
          env: process.env,
          timeoutMs: 60_000,
          emulatorPromise,
        }).catch(err => err);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(AndroidEmulatorExitedError);
        expect(error.message).toContain('getprop sys.boot_completed exited with non-zero code: 1');
        expect(error.message).toContain('WARNING | Boot stalled waiting for system_server');
        // Startup output tail listener is detached once waitForReadyAsync finishes, while logCapture stays attached.
        expect(child.stderr.listenerCount('data')).toBe(stderrListenersBefore - 1);
      } finally {
        await buildCapture.finishAsync();
      }
    });

    it('handles an already-exited emulator when a probe rejects without unhandled rejections', async () => {
      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown): void => {
        unhandledRejections.push(reason);
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        const exitedPromise = Promise.reject(
          Object.assign(new Error('emulator exited with non-zero code: 1'), {
            status: 1,
            signal: null,
            stderr: 'FATAL | Crash before boot probe\n',
          })
        );
        // Observe so the test itself doesn't trigger an unhandled rejection before waitForReadyAsync runs.
        exitedPromise.catch(() => {});

        mockedSpawn.mockImplementation(() => {
          return Promise.reject(new Error('adb failed')) as any;
        });

        const error = await AndroidEmulatorUtils.waitForReadyAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
          emulatorPromise: exitedPromise,
        }).catch(err => err);

        // Also exercise the synchronous exit path during probe race (child.exitCode set synchronously).
        let rejectSecond!: (err: unknown) => void;
        const racingPromise = new Promise((_resolve, reject) => {
          rejectSecond = reject;
        }) as any;
        racingPromise.child = { exitCode: null, signalCode: null };
        mockedSpawn.mockImplementation((() => {
          racingPromise.child.exitCode = 1;
          rejectSecond(
            Object.assign(new Error('emulator exited with non-zero code: 1'), {
              status: 1,
              signal: null,
              stderr: 'FATAL | Synchronous exit during probe\n',
            })
          );
          return Promise.reject(new Error('adb probe rejected'));
        }) as any);

        const secondError = await AndroidEmulatorUtils.waitForReadyAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
          emulatorPromise: racingPromise,
        }).catch(err => err);

        await new Promise<void>(resolve => setImmediate(resolve));

        expect(error).toBeInstanceOf(AndroidEmulatorExitedError);
        expect(error.message).toContain('FATAL | Crash before boot probe');
        expect(secondError).toBeInstanceOf(AndroidEmulatorExitedError);
        expect(secondError.exitCode).toBe(1);
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }
    });
  });

  describe(AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync, () => {
    it('sets window and transition animation scales to zero', async () => {
      const logger = createMockLogger();

      await AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
        logger,
      });

      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        'Disabling Android emulator window animations.'
      );
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        1,
        'adb',
        [
          '-s',
          'emulator-5554',
          'shell',
          'settings',
          'put',
          'global',
          'window_animation_scale',
          '0',
        ],
        { env: process.env }
      );
      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        'Disabling Android emulator transition animations.'
      );
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        2,
        'adb',
        [
          '-s',
          'emulator-5554',
          'shell',
          'settings',
          'put',
          'global',
          'transition_animation_scale',
          '0',
        ],
        { env: process.env }
      );
    });

    it('logs and swallows failures when disabling animations', async () => {
      const logger = createMockLogger();
      mockedSpawn
        .mockRejectedValueOnce(new Error('window failed'))
        .mockRejectedValueOnce(new Error('transition failed'));

      await expect(
        AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
          logger,
        })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          err: expect.objectContaining({ message: 'window failed' }),
        }),
        'Failed to disable Android emulator window animations.'
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          err: expect.objectContaining({ message: 'transition failed' }),
        }),
        'Failed to disable Android emulator transition animations.'
      );
    });
  });

  describe(AndroidEmulatorUtils.stopAsync, () => {
    it('kills emulator and waits for it to detach', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[2] === 'emu' && args[3] === 'kill') {
          return { stdout: '', stderr: '' } as any;
        }
        if (args[0] === 'devices') {
          return { stdout: 'List of devices attached\n\n', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.stopAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'emu', 'kill'], {
        env: process.env,
      });
      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['devices', '-l'], {
        env: process.env,
      });
    });
  });

  describe(AndroidEmulatorUtils.deleteAsync, () => {
    it('stops by serial id and then deletes the AVD', async () => {
      mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

      await AndroidEmulatorUtils.deleteAsync({
        serialId: 'emulator-5554' as any,
        deviceName: 'eas-simulator-1' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'emu', 'kill'], {
        env: process.env,
      });
      expect(mockedSpawn).toHaveBeenCalledWith(
        'avdmanager',
        ['delete', 'avd', '-n', 'eas-simulator-1'],
        {
          env: process.env,
        }
      );
    });

    it('deletes the AVD directly without calling adb when skipStop is true', async () => {
      mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

      await AndroidEmulatorUtils.deleteAsync({
        deviceName: 'eas-simulator-1' as any,
        env: process.env,
        skipStop: true,
      });

      expect(mockedSpawn).not.toHaveBeenCalledWith('adb', expect.anything(), expect.anything());
      expect(mockedSpawn).toHaveBeenCalledWith(
        'avdmanager',
        ['delete', 'avd', '-n', 'eas-simulator-1'],
        {
          env: process.env,
        }
      );
    });
  });
});
