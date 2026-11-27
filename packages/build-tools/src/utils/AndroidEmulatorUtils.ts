import { ExpoError, SystemError, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import assert from 'assert';
import FastGlob from 'fast-glob';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { Socket, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { Sentry } from '../sentry';
import { type AndroidEmulatorLogCapture } from './androidEmulatorLogCapture';
import { retryAsync } from './retry';

/** Android Virtual Device is the device we run. */
export type AndroidVirtualDeviceName = string & z.BRAND<'AndroidVirtualDeviceName'>;
/** Android device is configuration for the AVD -- screen size, etc. */
export type AndroidDeviceName = string & z.BRAND<'AndroidDeviceName'>;
export type AndroidDeviceSerialId = string & z.BRAND<'AndroidDeviceSerialId'>;

/**
 * Starts the emulator through a wrapper that waits on stdin, so the wrapper's
 * pid can be placed (for example, into a cgroup) before the emulator execs.
 */
export type AndroidEmulatorLaunchGate = {
  emulatorArgs: string[];
  wrapperCommand: string;
  wrapperArgs: string[];
  admitAsync: (pid: number) => Promise<void>;
};

const EMULATOR_STDIO_CLOSE_WAIT_MS = 100;
const MAX_STARTUP_OUTPUT_BUFFER_CHARS = 16_384;
const MAX_EMULATOR_OUTPUT_TAIL_LINES = 30;
const MAX_EMULATOR_OUTPUT_TAIL_CHARS = 4_000;

const NON_RETRYABLE_EMULATOR_EXIT_PATTERNS = [
  /kvm is required to run this avd/i,
  /emulation currently requires hardware acceleration/i,
  /could not access kvm kernel module/i,
  /\/dev\/kvm.*permission denied/i,
  /panic:\s*missing emulator engine program/i,
  /panic:\s*broken avd system path/i,
  /panic:\s*cannot find avd system path/i,
  /unknown avd name/i,
  /unsupported cpu architecture/i,
  /running .* on .* is not supported/i,
  /this avd(?:'s)? configuration is missing a kernel file/i,
];

export class AndroidEmulatorExitedError extends Error {
  public readonly exitCode: number | null;
  public readonly signal: NodeJS.Signals | string | null;
  public readonly outputTail: string;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    {
      exitCode,
      signal,
      outputTail,
      isRetryable,
      cause,
    }: {
      exitCode: number | null;
      signal: NodeJS.Signals | string | null;
      outputTail: string;
      isRetryable: boolean;
      cause?: unknown;
    }
  ) {
    super(message, { cause });
    this.name = 'AndroidEmulatorExitedError';
    this.exitCode = exitCode;
    this.signal = signal;
    this.outputTail = outputTail;
    this.isRetryable = isRetryable;
  }
}

type EmulatorExitInfo = {
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  cause?: unknown;
  spawnOutput: string;
};

type EmulatorProcessTracker = {
  hasExited: () => boolean;
  onExit: (listener: () => void) => () => void;
  getOutputTail: () => string;
  createExitedErrorAsync: (target: string) => Promise<AndroidEmulatorExitedError>;
  stopOutputCapture: () => void;
};

const emulatorProcessTrackers = new WeakMap<Promise<unknown>, EmulatorProcessTracker>();

function formatSpawnResultOutput(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const candidate = value as {
    stdout?: unknown;
    stderr?: unknown;
    output?: unknown;
  };
  const parts: string[] = [];
  if (typeof candidate.stdout === 'string' && candidate.stdout) {
    parts.push(candidate.stdout);
  }
  if (typeof candidate.stderr === 'string' && candidate.stderr) {
    parts.push(candidate.stderr);
  }
  if (parts.length === 0 && Array.isArray(candidate.output)) {
    for (const entry of candidate.output) {
      if (typeof entry === 'string' && entry) {
        parts.push(entry);
      }
    }
  }
  return parts.join('\n');
}

function formatEmulatorOutputTail(rawOutput: string): string {
  const normalized = rawOutput.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }
  const lines = normalized.split('\n');
  let tail = lines.slice(-MAX_EMULATOR_OUTPUT_TAIL_LINES).join('\n');
  if (tail.length > MAX_EMULATOR_OUTPUT_TAIL_CHARS) {
    tail = tail.slice(-MAX_EMULATOR_OUTPUT_TAIL_CHARS);
    const firstNewline = tail.indexOf('\n');
    if (firstNewline !== -1 && firstNewline < tail.length - 1) {
      tail = tail.slice(firstNewline + 1);
    }
  }
  return tail.trim();
}

function isNonRetryableEmulatorExitOutput(output: string): boolean {
  return NON_RETRYABLE_EMULATOR_EXIT_PATTERNS.some(pattern => pattern.test(output));
}

function appendEmulatorOutputTail(err: unknown, outputTail: string): unknown {
  if (!outputTail || err instanceof ExpoError || err instanceof AndroidEmulatorExitedError) {
    return err;
  }
  const baseMessage = err instanceof Error ? err.message : String(err);
  return new Error(`${baseMessage}\n\nLast emulator output:\n${outputTail}`, { cause: err });
}

function trackEmulatorProcess(
  emulatorPromise: Promise<unknown>,
  { capturePipedStdio }: { capturePipedStdio: boolean }
): EmulatorProcessTracker {
  const existing = emulatorProcessTrackers.get(emulatorPromise);
  if (existing) {
    return existing;
  }

  let exitInfo: EmulatorExitInfo | null = null;
  let outputBuffer = '';
  let isClosed = !capturePipedStdio;
  const exitListeners = new Set<() => void>();
  const child = (emulatorPromise as Partial<SpawnPromise<SpawnResult>>).child;

  const onData = (chunk: Buffer | string): void => {
    outputBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (outputBuffer.length > MAX_STARTUP_OUTPUT_BUFFER_CHARS) {
      outputBuffer = outputBuffer.slice(-MAX_STARTUP_OUTPUT_BUFFER_CHARS);
    }
  };

  const stopOutputCapture = (): void => {
    child?.stdout?.off('data', onData);
    child?.stderr?.off('data', onData);
  };

  let closePromise: Promise<void> | undefined;
  if (capturePipedStdio && child) {
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    if (typeof child.once === 'function') {
      closePromise = new Promise<void>(resolve => {
        child.once('close', () => {
          isClosed = true;
          stopOutputCapture();
          resolve();
        });
      });
    } else {
      isClosed = true;
    }
  }

  const notifyExit = (): void => {
    for (const listener of [...exitListeners]) {
      listener();
    }
    exitListeners.clear();
  };

  // Observe the process promise immediately so expected exits during retry cleanup
  // never become unhandled rejections, and so polling can fail fast on premature exit.
  void Promise.resolve(emulatorPromise).then(
    result => {
      const spawnResult = result as Partial<SpawnResult> | undefined;
      exitInfo = {
        exitCode: typeof spawnResult?.status === 'number' ? spawnResult.status : 0,
        signal: spawnResult?.signal ?? null,
        spawnOutput: formatSpawnResultOutput(spawnResult),
      };
      notifyExit();
    },
    err => {
      const spawnErr = err as Partial<SpawnResult> | undefined;
      exitInfo = {
        exitCode: typeof spawnErr?.status === 'number' ? spawnErr.status : null,
        signal: spawnErr?.signal ?? null,
        cause: err,
        spawnOutput: formatSpawnResultOutput(spawnErr),
      };
      notifyExit();
    }
  );

  const waitForStdioFlushAsync = async (): Promise<void> => {
    if (isClosed || !closePromise) {
      return;
    }
    await new Promise<void>(resolve => {
      const timer = globalThis.setTimeout(resolve, EMULATOR_STDIO_CLOSE_WAIT_MS);
      timer.unref();
      void closePromise.then(() => {
        globalThis.clearTimeout(timer);
        resolve();
      });
    });
  };

  const hasExited = (): boolean =>
    exitInfo !== null ||
    (child !== undefined &&
      ((typeof child.exitCode === 'number' && child.exitCode !== null) ||
        child.signalCode != null));

  const tracker: EmulatorProcessTracker = {
    hasExited,
    onExit: listener => {
      if (hasExited()) {
        listener();
        return () => {};
      }
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    getOutputTail: () => formatEmulatorOutputTail(outputBuffer || exitInfo?.spawnOutput || ''),
    createExitedErrorAsync: async target => {
      await waitForStdioFlushAsync();
      stopOutputCapture();
      const info: EmulatorExitInfo = exitInfo ?? {
        exitCode: typeof child?.exitCode === 'number' ? child.exitCode : null,
        signal: child?.signalCode ?? null,
        spawnOutput: '',
      };
      const rawOutput = outputBuffer || info.spawnOutput;
      const outputTail = formatEmulatorOutputTail(rawOutput);
      const causeMessage =
        info.cause instanceof Error && info.cause.message ? info.cause.message : undefined;
      let reason: string;
      if (info.signal) {
        reason = `with signal ${info.signal}`;
      } else if (info.exitCode !== null) {
        reason = `with exit code ${info.exitCode}`;
      } else if (causeMessage) {
        reason = `(${causeMessage})`;
      } else {
        reason = 'unexpectedly';
      }
      const message = outputTail
        ? `Android emulator (${target}) exited prematurely during startup ${reason}.\n\nLast emulator output:\n${outputTail}`
        : `Android emulator (${target}) exited prematurely during startup ${reason}.`;
      return new AndroidEmulatorExitedError(message, {
        exitCode: info.exitCode,
        signal: info.signal,
        outputTail,
        isRetryable: !isNonRetryableEmulatorExitOutput(rawOutput),
        cause: info.cause,
      });
    },
    stopOutputCapture,
  };

  emulatorProcessTrackers.set(emulatorPromise, tracker);
  return tracker;
}

function raceWithEmulatorExitAsync<T>(
  promise: Promise<T>,
  tracker: EmulatorProcessTracker,
  target: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (cb: () => void): void => {
      if (!settled) {
        settled = true;
        unsubscribe?.();
        unsubscribe = undefined;
        cb();
      }
    };
    const failWithExit = (): void => {
      finish(() => {
        void tracker.createExitedErrorAsync(target).then(reject, reject);
      });
    };

    // Attach handlers to `promise` before checking exit state so a rejected probe
    // never becomes an unhandled rejection when the emulator has already exited.
    promise.then(
      value => finish(() => resolve(value)),
      err => {
        if (tracker.hasExited()) {
          failWithExit();
        } else {
          finish(() => reject(err));
        }
      }
    );

    if (tracker.hasExited()) {
      failWithExit();
      return;
    }
    unsubscribe = tracker.onExit(failWithExit);
  });
}

export namespace AndroidEmulatorUtils {
  const RETRY_INTERVAL_MS = 1_000;
  const FIRST_CONSOLE_PORT = 5554;
  const LAST_CONSOLE_PORT = 5584;

  export const defaultSystemImagePackage = `system-images;android-30;default;${
    process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  }`;

  export async function getAvailableDevicesAsync({
    env,
  }: {
    env: NodeJS.ProcessEnv;
  }): Promise<AndroidDeviceName[]> {
    const result = await spawn('avdmanager', ['list', 'device', '--compact', '--null'], { env });
    return result.stdout.split('\0').filter(line => line !== '') as AndroidDeviceName[];
  }

  export async function getAttachedDevicesAsync({
    env,
    signal,
  }: {
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }): Promise<{ serialId: AndroidDeviceSerialId; state: 'offline' | 'device' }[]> {
    const result = await spawn('adb', ['devices', '-l'], { env, signal });
    return result.stdout
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(line => line.startsWith('emulator'))
      .map(line => {
        const [serialId, state] = line.split(/\s+/) as [
          AndroidDeviceSerialId,
          'offline' | 'device',
        ];
        return {
          serialId,
          state,
        };
      });
  }

  export async function getSerialIdAsync({
    deviceName,
    env,
  }: {
    deviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
  }): Promise<AndroidDeviceSerialId | null> {
    const adbDevices = await spawn('adb', ['devices'], { env });
    for (const adbDeviceLine of adbDevices.stdout.split('\n')) {
      if (!adbDeviceLine.startsWith('emulator')) {
        continue;
      }

      const matches = adbDeviceLine.match(/^(\S+)/);
      if (!matches) {
        continue;
      }

      const [, serialId] = matches;
      // Previously we were using `qemu.uuid` to identify the emulator,
      // but this does not work for newer emulators, because there is
      // a limit on properties and custom properties get ignored.
      // See https://stackoverflow.com/questions/2214377/how-to-get-serial-number-or-id-of-android-emulator-after-it-runs#comment98259121_42038655
      const adbEmuAvdName = await spawn('adb', ['-s', serialId, 'emu', 'avd', 'name'], {
        env,
      });
      if (adbEmuAvdName.stdout.replace(/\r\n/g, '\n').split('\n')[0] === deviceName) {
        return serialId as AndroidDeviceSerialId;
      }
    }

    return null;
  }

  export async function createAsync({
    deviceName,
    systemImagePackage,
    deviceIdentifier,
    lcdWidth,
    lcdHeight,
    lcdDensity,
    env,
    logger,
  }: {
    deviceName: AndroidVirtualDeviceName;
    systemImagePackage: string;
    deviceIdentifier: AndroidDeviceName | null;
    lcdWidth: number | null;
    lcdHeight: number | null;
    lcdDensity: number | null;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
  }): Promise<void> {
    const avdManager = spawn(
      'avdmanager',
      [
        'create',
        'avd',
        '--name',
        deviceName,
        '--package',
        systemImagePackage,
        '--force',
        ...(deviceIdentifier ? ['--device', deviceIdentifier] : []),
      ],
      {
        env,
        stdio: 'pipe',
      }
    );
    // `avdmanager create` always asks about creating a custom hardware profile.
    // > Do you wish to create a custom hardware profile? [no]
    // We answer "no".
    avdManager.child.stdin?.write('no');
    avdManager.child.stdin?.end();
    try {
      await avdManager;
    } catch (err) {
      const output = formatSpawnResultOutput(err);
      if (/package path is not valid/i.test(output)) {
        throw new UserError(
          'EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND',
          `Android system image "${systemImagePackage}" is not installed or is not a valid AVD system image package.`,
          { cause: err }
        );
      }
      throw err;
    }

    // Add extra config to the device's ini file.
    const configIniFile = `${env.HOME}/.android/avd/${deviceName}.avd/config.ini`;
    try {
      let configIniFileContent = await fs.promises.readFile(configIniFile, 'utf-8');

      // Keep the lower RAM default for older images; newer guests need more headroom for ADB.
      const apiLevel = systemImagePackage.match(/^system-images;android-(\d+)/)?.[1];
      const ramSize = !env.DEVICE_RUN_SESSION_ID && apiLevel && Number(apiLevel) < 35 ? 2048 : 4096;
      logger.info(`Setting hw.ramSize to ${ramSize}.`);
      configIniFileContent = `${configIniFileContent}\nhw.ramSize=${ramSize}\n`;

      const shouldResizeScreen =
        env.ANDROID_EMULATOR_ADJUST_SCREEN === 'true' || env.ANDROID_EMULATOR_ADJUST_SCREEN === '1';
      if (shouldResizeScreen) {
        const currentDensityString = configIniFileContent.match(/hw.lcd.density=(\d+)/)?.[1];
        const currentDensity = currentDensityString
          ? parseInt(currentDensityString, 10)
          : undefined;
        const currentHeightString = configIniFileContent.match(/hw.lcd.height=(\d+)/)?.[1];
        const currentHeight = currentHeightString ? parseInt(currentHeightString, 10) : undefined;
        const currentWidthString = configIniFileContent.match(/hw.lcd.width=(\d+)/)?.[1];
        const currentWidth = currentWidthString ? parseInt(currentWidthString, 10) : undefined;

        if (currentDensity && currentDensity > 220) {
          logger.info(
            `Current density is ${currentDensity}, which we believe may impact performance.`
          );
          if (currentHeight && currentWidth) {
            const newDensity = 220;
            logger.info(`Setting hw.lcd.density to ${newDensity}.`);
            configIniFileContent = `${configIniFileContent}\nhw.lcd.density=${newDensity}\n`;

            const newHeight = Math.round((currentHeight * newDensity) / currentDensity);
            const newWidth = Math.round((currentWidth * newDensity) / currentDensity);
            logger.info(
              `Setting scaled screen resolution: hw.lcd.height to ${newHeight} and hw.lcd.width to ${newWidth}.`
            );
            configIniFileContent = `${configIniFileContent}\nhw.lcd.height=${newHeight}\nhw.lcd.width=${newWidth}\n`;
          } else {
            logger.info(
              'Could not find current screen resolution, setting to 1170x540 and 220 ppi.'
            );
            configIniFileContent = `${configIniFileContent}\nhw.lcd.height=${1170}\nhw.lcd.width=${540}\nhw.lcd.density=220\n`;
          }
        }
      }

      if (lcdWidth !== null && lcdHeight !== null && lcdDensity !== null) {
        logger.info(
          `Setting screen resolution to ${lcdWidth}x${lcdHeight} and density to ${lcdDensity} ppi.`
        );
        configIniFileContent = `${configIniFileContent}\nhw.lcd.height=${lcdHeight}\nhw.lcd.width=${lcdWidth}\nhw.lcd.density=${lcdDensity}\n`;
      }

      const shouldAdjustHeapSize =
        env.ANDROID_EMULATOR_ADJUST_HEAP_SIZE !== 'false' &&
        env.ANDROID_EMULATOR_ADJUST_HEAP_SIZE !== '0';
      if (shouldAdjustHeapSize) {
        const heapSizeString = configIniFileContent.match(/vm.heapSize=(\d\w+)/)?.[1];
        if (!heapSizeString) {
          logger.info('Setting vm.heapSize to 768 MB.');
          configIniFileContent = `${configIniFileContent}\nvm.heapSize=768\n`;
        } else if (heapSizeString) {
          const heapSize = parseInt(heapSizeString, 10);
          const lowerCaseHeapSizeString = heapSizeString.toLocaleLowerCase();
          if (lowerCaseHeapSizeString.includes('g')) {
            logger.info('vm.heapSize is in GB, skipping adjustment.');
          } else if (heapSize < 768) {
            logger.info('Bumping vm.heapSize to 768 MB.');
            configIniFileContent = `${configIniFileContent}\nvm.heapSize=768\n`;
          }
        }
      }

      if (env.ANDROID_EMULATOR_EXTRA_CONFIG) {
        logger.info(
          `Adding extra config from $ANDROID_EMULATOR_EXTRA_CONFIG:\n${env.ANDROID_EMULATOR_EXTRA_CONFIG}`
        );
        configIniFileContent = `${configIniFileContent}\n${env.ANDROID_EMULATOR_EXTRA_CONFIG}\n`;
      }

      await fs.promises.writeFile(configIniFile, configIniFileContent);
    } catch (err) {
      logger.warn({ err }, `Failed to add extra config to ${configIniFile}.`);
    }
  }

  export async function cloneAsync({
    sourceDeviceName,
    destinationDeviceName,
    env,
    logger,
  }: {
    sourceDeviceName: AndroidVirtualDeviceName;
    destinationDeviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
  }): Promise<void> {
    const cloneIniFile = `${env.HOME}/.android/avd/${destinationDeviceName}.ini`;

    try {
      // Clean destination device files
      await fs.promises.rm(`${env.HOME}/.android/avd/${destinationDeviceName}.avd`, {
        recursive: true,
        force: true,
      });
      await fs.promises.rm(cloneIniFile, { force: true });
    } catch (err) {
      logger.warn({ err }, `Failed to remove destination device files ${destinationDeviceName}.`);
    }

    try {
      // Remove lockfiles from source device
      const sourceLockfiles = await FastGlob('./**/*.lock', {
        cwd: `${env.HOME}/.android/avd/${sourceDeviceName}.avd`,
        absolute: true,
      });
      await Promise.all(sourceLockfiles.map(lockfile => fs.promises.rm(lockfile, { force: true })));
    } catch (err) {
      logger.warn({ err }, `Failed to remove lockfiles from source device ${sourceDeviceName}.`);
    }

    // Copy source to destination
    await fs.promises.cp(
      `${env.HOME}/.android/avd/${sourceDeviceName}.avd`,
      `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
      { recursive: true, verbatimSymlinks: true, force: true }
    );

    await fs.promises.cp(`${env.HOME}/.android/avd/${sourceDeviceName}.ini`, cloneIniFile, {
      verbatimSymlinks: true,
      force: true,
    });

    // Remove lockfiles from destination device
    try {
      const lockfiles = await FastGlob('./**/*.lock', {
        cwd: `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
        absolute: true,
      });
      await Promise.all(lockfiles.map(lockfile => fs.promises.rm(lockfile, { force: true })));
    } catch (err) {
      logger.warn(
        { err },
        `Failed to remove lockfiles from destination device ${destinationDeviceName}.`
      );
    }

    const filesToReplaceDeviceNameIn = // TODO: Test whether we need to use `spawnAsync` here.
      (
        await spawn('grep', [
          '--binary-files=without-match',
          '--recursive',
          '--files-with-matches',
          `${sourceDeviceName}`,
          `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
        ])
      ).stdout
        .split('\n')
        .filter(file => file !== '');

    for (const file of [...filesToReplaceDeviceNameIn, cloneIniFile]) {
      try {
        const txtFile = await fs.promises.readFile(file, 'utf-8');
        const replaceRegex = new RegExp(`${sourceDeviceName}`, 'g');
        const updatedTxtFile = txtFile.replace(replaceRegex, destinationDeviceName);
        await fs.promises.writeFile(file, updatedTxtFile);
      } catch (err) {
        logger.warn({ err }, `Failed to replace device name in ${file}.`);
      }
    }
  }

  export async function startAsync({
    deviceName,
    env,
    logcatDirectory,
    launchGate,
    logCapture,
    consolePort,
    extraEnv = {},
  }: {
    deviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
    logcatDirectory: string;
    launchGate?: AndroidEmulatorLaunchGate;
    logCapture: AndroidEmulatorLogCapture;
    /**
     * The console port, from `findFreeConsolePortAsync`. It sets the serial (`emulator-<port>`)
     * before the start. Without it, the emulator picks a free port itself.
     */
    consolePort?: number;
    /** Environment variables for the emulator process only. */
    extraEnv?: Record<string, string>;
  }): Promise<{
    emulatorPromise: SpawnPromise<SpawnResult>;
    serialId: AndroidDeviceSerialId;
  }> {
    let logcatOutputPath: string | undefined;
    let emulatorOutputPath: string | undefined;
    try {
      await fs.promises.mkdir(logcatDirectory, { recursive: true });
      const safeDeviceName = deviceName.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const timestamp = Math.floor(Date.now() / 1000)
        .toString(16)
        .padStart(8, '0');
      const outputName = `${safeDeviceName}-${timestamp}-${randomBytes(2).toString('hex')}`;
      if (logCapture.sources.includes('device-logcat')) {
        logcatOutputPath = path.join(logcatDirectory, `${outputName}-logcat.log`);
      }
      if (logCapture.sources.includes('emulator-output')) {
        emulatorOutputPath = path.join(logcatDirectory, `${outputName}-emulator.log`);
      }
    } catch (err) {
      throw new SystemError(`Failed to prepare Android emulator output for ${deviceName}.`, {
        cause: err,
      });
    }

    const logcatOutput = logcatOutputPath
      ? await logCapture.prepareLogcatOutputAsync(logcatOutputPath)
      : undefined;
    const emulatorCommand = `${process.env.ANDROID_HOME}/emulator/emulator`;
    const emulatorArgs = [
      '-no-window',
      '-no-boot-anim',
      '-writable-system',
      '-noaudio',
      '-no-snapshot-save',
      ...(logcatOutput ? ['-logcat', '*:v', '-logcat-output', logcatOutput.path] : []),
      '-avd',
      deviceName,
      '-accel',
      'on',
      ...(consolePort !== undefined ? ['-port', String(consolePort)] : []),
      ...(typeof env.ANDROID_EMULATOR_EXTRA_ARGS === 'string'
        ? env.ANDROID_EMULATOR_EXTRA_ARGS.split(' ')
        : []),
    ];
    const emulatorEnv = {
      ...env,
      ...extraEnv,
      // We don't need to wait for emulator to exit gracefully.
      ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1',
    };
    const outputStdio = emulatorOutputPath ? 'pipe' : 'ignore';
    const emulatorPromise = launchGate
      ? spawn(
          launchGate.wrapperCommand,
          [...launchGate.wrapperArgs, emulatorCommand, ...emulatorArgs, ...launchGate.emulatorArgs],
          {
            detached: true,
            stdio: ['pipe', outputStdio, outputStdio],
            ignoreStdio: true,
            env: emulatorEnv,
          }
        )
      : spawn(emulatorCommand, emulatorArgs, {
          detached: true,
          stdio: ['ignore', outputStdio, outputStdio],
          ignoreStdio: true,
          env: emulatorEnv,
        });
    if (logcatOutput) {
      emulatorPromise.child.once('close', logcatOutput.close);
    }
    if (emulatorOutputPath) {
      for (const input of [emulatorPromise.child.stdout, emulatorPromise.child.stderr]) {
        if (input) {
          logCapture.attach(input, emulatorOutputPath, 'emulator-output');
        }
      }
      emulatorPromise.child.once('close', () => {
        void logCapture.finishFileAsync(emulatorOutputPath);
      });
    }
    // Piped stdio creates socket handles in this process which, unlike inherited
    // file descriptors, keep the event loop alive for as long as the emulator runs.
    // We never stop the emulator explicitly, so without unref-ing these the process
    // would never exit on its own -- defeating the `detached` + `unref()` below.
    // Output is still captured for as long as this process lives.
    if (emulatorPromise.child.stdout instanceof Socket) {
      emulatorPromise.child.stdout.unref();
    }
    if (emulatorPromise.child.stderr instanceof Socket) {
      emulatorPromise.child.stderr.unref();
    }
    // Track exit and capture a bounded startup output tail after logCapture.attach
    // so pipes stay in the right order and we never miss early fatal stderr lines.
    const tracker = trackEmulatorProcess(emulatorPromise, {
      capturePipedStdio: Boolean(emulatorOutputPath),
    });
    // If emulator fails to start, throw its error.
    if (!emulatorPromise.child.pid) {
      tracker.stopOutputCapture();
      await emulatorPromise;
    }
    if (launchGate && emulatorPromise.child.pid) {
      try {
        await launchGate.admitAsync(emulatorPromise.child.pid);
      } catch (err) {
        tracker.stopOutputCapture();
        emulatorPromise.child.kill('SIGKILL');
        await asyncResult(emulatorPromise);
        throw err;
      }
      emulatorPromise.child.stdin?.end('go\n');
    }
    emulatorPromise.child.unref();

    // Yield one microtask so an already-settled emulatorPromise updates exit state before polling adb.
    await Promise.resolve();

    const abortController = new AbortController();
    const unsubscribeAbort = tracker.onExit(() => abortController.abort());
    let serialId: AndroidDeviceSerialId;
    try {
      serialId = await retryAsync(
        async () => {
          if (tracker.hasExited()) {
            throw await tracker.createExitedErrorAsync(deviceName);
          }
          const foundSerialId = await raceWithEmulatorExitAsync(
            getSerialIdAsync({ deviceName, env }),
            tracker,
            deviceName
          );
          assert(
            foundSerialId,
            `Failed to configure emulator (${foundSerialId}): emulator with required ID not found.`
          );
          return foundSerialId;
        },
        {
          retryOptions: {
            retries: 3 * 60,
            retryIntervalMs: 1_000,
          },
          shouldRetry: err => !(err instanceof AndroidEmulatorExitedError),
          signal: abortController.signal,
        }
      );
    } catch (err) {
      if (err instanceof AndroidEmulatorExitedError) {
        throw err;
      }
      if (tracker.hasExited()) {
        throw await tracker.createExitedErrorAsync(deviceName);
      }
      const outputTail = tracker.getOutputTail();
      tracker.stopOutputCapture();
      if (typeof emulatorPromise.child.kill === 'function') {
        try {
          emulatorPromise.child.kill('SIGKILL');
        } catch {
          // Ignore errors when killing an already-terminated process.
        }
      }
      throw appendEmulatorOutputTail(err, outputTail);
    } finally {
      unsubscribeAbort();
    }

    // We don't want to await the SpawnPromise here.
    // eslint-disable-next-line @typescript-eslint/return-await
    return { emulatorPromise, serialId };
  }

  export async function waitForReadyAsync({
    serialId,
    env,
    timeoutMs = 3 * 60 * 1_000,
    logger,
    networkReadyTarget,
    emulatorPromise,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
    logger?: bunyan;
    /** Host and port the guest must reach; 1.1.1.1:443 unless set. */
    networkReadyTarget?: { host: string; port: number };
    /** Running emulator process promise; when provided, polling fails fast if the emulator exits. */
    emulatorPromise?: Promise<unknown>;
  }): Promise<void> {
    const retries = Math.max(0, Math.ceil(timeoutMs / RETRY_INTERVAL_MS) - 1);
    const tracker = emulatorPromise
      ? trackEmulatorProcess(emulatorPromise, { capturePipedStdio: false })
      : undefined;
    if (tracker) {
      // Yield one microtask so an already-settled emulatorPromise updates exit state before polling adb.
      await Promise.resolve();
    }
    const abortController = tracker ? new AbortController() : undefined;
    const unsubscribeAbort =
      tracker && abortController ? tracker.onExit(() => abortController.abort()) : undefined;

    try {
      await retryAsync(
        async () => {
          if (tracker?.hasExited()) {
            throw await tracker.createExitedErrorAsync(serialId);
          }

          const bootCheck = spawn(
            'adb',
            ['-s', serialId, 'shell', 'getprop', 'sys.boot_completed'],
            { env }
          );
          const { stdout } = tracker
            ? await raceWithEmulatorExitAsync(bootCheck, tracker, serialId)
            : await bootCheck;

          if (!stdout.startsWith('1')) {
            throw new Error(`Emulator (${serialId}) boot has not completed.`);
          }

          const networkCheck = hasNetworkConnectionAsync({
            serialId,
            env,
            target: networkReadyTarget,
          });
          const hasNetworkConnection = tracker
            ? await raceWithEmulatorExitAsync(networkCheck, tracker, serialId)
            : await networkCheck;
          if (!hasNetworkConnection) {
            throw new Error(`Emulator (${serialId}) network is not ready.`);
          }
        },
        {
          retryOptions: {
            retries,
            retryIntervalMs: RETRY_INTERVAL_MS,
          },
          logger,
          ...(tracker
            ? {
                shouldRetry: (err: unknown) => !(err instanceof AndroidEmulatorExitedError),
                signal: abortController?.signal,
              }
            : {}),
        }
      );
    } catch (err) {
      if (err instanceof AndroidEmulatorExitedError) {
        throw err;
      }
      if (tracker?.hasExited()) {
        throw await tracker.createExitedErrorAsync(serialId);
      }
      const outputTail = tracker?.getOutputTail() ?? '';
      throw appendEmulatorOutputTail(err, outputTail);
    } finally {
      unsubscribeAbort?.();
      tracker?.stopOutputCapture();
    }
  }

  export async function disableWindowAndTransitionAnimationsAsync({
    serialId,
    env,
    logger,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
  }): Promise<void> {
    logger.info('Disabling Android emulator window animations.');
    try {
      await spawn(
        'adb',
        ['-s', serialId, 'shell', 'settings', 'put', 'global', 'window_animation_scale', '0'],
        { env }
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to disable Android emulator window animations.');
    }

    logger.info('Disabling Android emulator transition animations.');
    try {
      await spawn(
        'adb',
        ['-s', serialId, 'shell', 'settings', 'put', 'global', 'transition_animation_scale', '0'],
        { env }
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to disable Android emulator transition animations.');
    }
  }

  async function hasNetworkConnectionAsync({
    serialId,
    env,
    target = { host: '1.1.1.1', port: 443 },
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    target?: { host: string; port: number };
  }): Promise<boolean> {
    const networkReadyCheckCommand = env.ANDROID_EMULATOR_NETWORK_READY_COMMAND?.trim();
    if (networkReadyCheckCommand) {
      const customNetworkCheckResult = await asyncResult(
        spawn('adb', ['-s', serialId, 'shell', networkReadyCheckCommand], { env })
      );
      return customNetworkCheckResult.ok;
    }

    const netcatResult = await asyncResult(
      spawn(
        'adb',
        ['-s', serialId, 'shell', 'nc', '-w', '1', target.host, String(target.port)],
        // Close stdin to make netcat exit cleanly on Android images that don't support `-z`.
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    );
    return netcatResult.ok;
  }

  export async function collectLogsAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<{ outputPath: string }> {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-emulator-logs-'));
    const outputPath = path.join(outputDir, `${serialId}.log`);

    // Pipe adb logcat output directly to the file to avoid loading it all into memory
    await new Promise<void>((resolve, reject) => {
      const { child } = spawn('adb', ['-s', serialId, 'logcat', '-d'], {
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
      });

      if (!child.stdout) {
        reject(new Error('"adb logcat" did not start correctly.'));
        return;
      }

      const writeStream = fs.createWriteStream(outputPath);
      child.stdout.pipe(writeStream);
      child.stdout.on('error', reject);

      child.on('error', reject);
      writeStream.on('error', reject);

      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`"adb logcat" exited with code ${code}`));
        }
      });
    });

    return { outputPath };
  }

  /**
   * A free console port: an even port from 5554 to 5584, the range that adb scans, whose next
   * port, for adb, is free too.
   */
  export async function findFreeConsolePortAsync(): Promise<number> {
    for (let port = FIRST_CONSOLE_PORT; port <= LAST_CONSOLE_PORT; port += 2) {
      if ((await isPortFreeAsync(port)) && (await isPortFreeAsync(port + 1))) {
        return port;
      }
    }
    throw new Error(
      `No emulator console port from ${FIRST_CONSOLE_PORT} to ${LAST_CONSOLE_PORT} is free.`
    );
  }

  async function isPortFreeAsync(port: number): Promise<boolean> {
    return await new Promise(resolve => {
      const server = createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
  }

  /** Force-stops every installed third-party app. */
  export async function forceStopUserAppsAsync({
    serialId,
    env,
    signal,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }): Promise<void> {
    await spawn(
      'adb',
      [
        '-s',
        serialId,
        'shell',
        'for p in $(pm list packages -3 | cut -d: -f2); do am force-stop "$p" || exit 1; done',
      ],
      { env, signal }
    );
  }

  export async function stopAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    await spawn('adb', ['-s', serialId, 'emu', 'kill'], { env });

    await retryAsync(
      async () => {
        const devices = await getAttachedDevicesAsync({ env });
        if (devices.some(device => device.serialId === serialId)) {
          throw new Error(`Emulator (${serialId}) is still attached.`);
        }
      },
      {
        retryOptions: {
          retries: 3 * 60,
          retryIntervalMs: RETRY_INTERVAL_MS,
        },
      }
    );
  }

  export async function deleteAsync({
    serialId,
    deviceName,
    env,
    skipStop = false,
  }: {
    serialId?: AndroidDeviceSerialId;
    deviceName?: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
    /** Skip stopping via adb when the emulator process is already known to have exited. */
    skipStop?: boolean;
  }): Promise<void> {
    let resolvedDeviceName = deviceName;
    if (!resolvedDeviceName && serialId) {
      const adbEmuAvdName = await spawn('adb', ['-s', serialId, 'emu', 'avd', 'name'], {
        env,
      });
      resolvedDeviceName = adbEmuAvdName.stdout.replace(/\r\n/g, '\n').split('\n')[0] as
        | AndroidVirtualDeviceName
        | undefined;
    }

    assert(resolvedDeviceName, 'Either "serialId" or "deviceName" must resolve to a device name.');

    if (!skipStop) {
      const serialIdToStop =
        serialId ?? (await getSerialIdAsync({ deviceName: resolvedDeviceName, env })) ?? undefined;
      if (serialIdToStop) {
        await stopAsync({ serialId: serialIdToStop, env });
      }
    }

    await spawn('avdmanager', ['delete', 'avd', '-n', resolvedDeviceName], { env });
  }

  export async function startScreenRecordingAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<{
    recordingSpawn: SpawnPromise<SpawnResult>;
  }> {
    let isReady = false;

    // Ensure /sdcard/ is ready to write to. (If the emulator was just booted, it might not be ready yet.)
    for (let i = 0; i < 30; i++) {
      try {
        await spawn('adb', ['-s', serialId, 'shell', 'touch', '/sdcard/.expo-recording-ready'], {
          env,
        });
        isReady = true;
        break;
      } catch {
        await setTimeout(1000);
      }
    }

    if (!isReady) {
      throw new Error(`Emulator (${serialId}) filesystem was not ready in time.`);
    }

    const screenrecordArgs = [
      '-s',
      serialId,
      'shell',
      'screenrecord',
      '--verbose',
      '/sdcard/expo-recording.mp4',
    ];

    const screenrecordHelp = await spawn(
      'adb',
      ['-s', serialId, 'shell', 'screenrecord', '--help'],
      {
        env,
      }
    );

    if (screenrecordHelp.stdout.includes('remove the time limit')) {
      screenrecordArgs.push('--time-limit', '0');
    }

    const recordingSpawn = spawn('adb', screenrecordArgs, {
      env,
      stdio: 'pipe',
    });
    recordingSpawn.child.unref();

    // We are returning the SpawnPromise here, so we don't await it.
    // eslint-disable-next-line @typescript-eslint/return-await
    return {
      recordingSpawn,
    };
  }

  export async function stopScreenRecordingAsync({
    serialId,
    recordingSpawn,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    recordingSpawn: SpawnPromise<SpawnResult>;
    env: NodeJS.ProcessEnv;
  }): Promise<{ outputPath: string }> {
    recordingSpawn.child.kill(1);

    try {
      await recordingSpawn;
    } catch {
      // do nothing
    }

    let isRecordingBusy = true;
    for (let i = 0; i < 30; i++) {
      const lsof = await spawn(
        'adb',
        ['-s', serialId, 'shell', 'lsof -t /sdcard/expo-recording.mp4'],
        { env }
      );
      if (lsof.stdout.trim() === '') {
        isRecordingBusy = false;
        break;
      }
      await setTimeout(1000);
    }

    if (isRecordingBusy) {
      throw new Error(`Recording file is busy.`);
    }

    const outputDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'android-screen-recording-')
    );
    const outputPath = path.join(outputDir, `${serialId}.mp4`);

    await spawn('adb', ['-s', serialId, 'pull', '/sdcard/expo-recording.mp4', outputPath], { env });

    return { outputPath };
  }
}
