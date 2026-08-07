import { asyncResult } from '@expo/results';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  AndroidDeviceSerialId,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../../utils/AndroidEmulatorUtils';
import { retryAsync } from '../../../utils/retry';
import { createCollectEmulatorLogsBuildFunction } from '../collectEmulatorLogs';

jest.unmock('fs');
jest.unmock('node:fs');

describe('createCollectEmulatorLogsBuildFunction', () => {
  it('copies staged emulator logcat files from the build logs directory', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'collect-emulator-logs-'));
    try {
      const buildLogsDirectory = path.join(tempDir, 'build-logs');
      const destinationPath = path.join(tempDir, 'maestro-tests', 'emulator-logs');
      const sourcePath = AndroidEmulatorUtils.getLogcatStagingDirectoryPath({ buildLogsDirectory });

      const firstLogDirectory = path.join(sourcePath, 'EasAndroidDevice01-abc123');
      const secondLogDirectory = path.join(sourcePath, 'eas-simulator-1-def456');
      await Promise.all([
        fs.promises.mkdir(firstLogDirectory, { recursive: true }),
        fs.promises.mkdir(secondLogDirectory, { recursive: true }),
      ]);
      await fs.promises.writeFile(path.join(firstLogDirectory, 'logcat.log'), 'first log\n');
      await fs.promises.writeFile(path.join(secondLogDirectory, 'logcat.log'), 'second log\n');
      await fs.promises.writeFile(path.join(secondLogDirectory, 'metadata.json'), '{}\n');

      const collectEmulatorLogs = createCollectEmulatorLogsBuildFunction();
      const step = collectEmulatorLogs.createBuildStepFromFunctionCall(
        createGlobalContextMock({
          logger: createMockLogger({ logToConsole: true }),
          buildLogsDirectory,
        }),
        {
          callInputs: {
            destination_path: destinationPath,
          },
        }
      );

      await expect(step.executeAsync()).resolves.not.toThrow();

      await expect(
        fs.promises.readFile(path.join(destinationPath, 'EasAndroidDevice01-abc123.log'), 'utf-8')
      ).resolves.toBe('first log\n');
      await expect(
        fs.promises.readFile(path.join(destinationPath, 'eas-simulator-1-def456.log'), 'utf-8')
      ).resolves.toBe('second log\n');
      await expect(
        fs.promises.access(path.join(destinationPath, 'metadata.json'))
      ).rejects.toThrow();
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('collects native logcat output across an ADB server restart', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'collect-emulator-logs-'));
    const deviceName =
      `android-emulator-logcat-e2e-${randomUUID().slice(0, 8)}` as AndroidVirtualDeviceName;
    let emulatorPromise: Promise<unknown> | null = null;
    let serialId: AndroidDeviceSerialId | null = null;

    try {
      const logger = createMockLogger({ logToConsole: true });
      const buildLogsDirectory = path.join(tempDir, 'build-logs');
      const destinationPath = path.join(tempDir, 'maestro-tests', 'emulator-logs');
      const marker = `ENG-20762-${randomUUID()}`;

      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
        deviceIdentifier: null,
        env: process.env,
        logger,
      });

      const startResult = await AndroidEmulatorUtils.startAsync({
        buildLogsDirectory,
        deviceName,
        env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
      });
      serialId = startResult.serialId;
      emulatorPromise = asyncResult(startResult.emulatorPromise);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: startResult.serialId,
        env: process.env,
      });

      await spawn('adb', ['kill-server'], { env: process.env });
      await spawn('adb', ['start-server'], { env: process.env });
      await spawn(
        'adb',
        ['-s', startResult.serialId, 'shell', 'log', '-t', 'EAS_CLI_TEST', marker],
        { env: process.env }
      );

      await retryAsync(
        async () => {
          const contents = await fs.promises.readFile(startResult.logcatOutputPath, 'utf-8');
          if (!contents.includes(marker)) {
            throw new Error(`Did not find marker ${marker} in staged log yet.`);
          }
        },
        {
          logger,
          retryOptions: {
            retries: 10,
            retryIntervalMs: 1_000,
          },
        }
      );

      const collectEmulatorLogs = createCollectEmulatorLogsBuildFunction();
      const step = collectEmulatorLogs.createBuildStepFromFunctionCall(
        createGlobalContextMock({
          logger,
          buildLogsDirectory,
        }),
        {
          callInputs: {
            destination_path: destinationPath,
          },
        }
      );

      await expect(step.executeAsync()).resolves.not.toThrow();

      const collectedLogFiles = (await fs.promises.readdir(destinationPath)).filter(entry =>
        entry.endsWith('.log')
      );
      expect(collectedLogFiles.length).toBeGreaterThan(0);
      const collectedLogPath = path.join(destinationPath, collectedLogFiles[0]);
      await expect(fs.promises.readFile(collectedLogPath, 'utf-8')).resolves.toContain(marker);
    } finally {
      try {
        if (serialId) {
          await AndroidEmulatorUtils.deleteAsync({
            serialId,
            deviceName,
            env: process.env,
          });
        } else {
          await AndroidEmulatorUtils.deleteAsync({
            deviceName,
            env: process.env,
          });
        }
      } catch (error) {
        console.warn(
          'Failed to clean up emulator during collectEmulatorLogs integration test',
          error
        );
      }
      if (emulatorPromise) {
        await emulatorPromise;
      }
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }, 180_000);
});
