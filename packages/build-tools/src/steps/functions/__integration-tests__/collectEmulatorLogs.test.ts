import { asyncResult } from '@expo/results';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  AndroidEmulatorUtils,
  AndroidDeviceSerialId,
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

      await fs.promises.mkdir(sourcePath, { recursive: true });
      await fs.promises.writeFile(path.join(sourcePath, '1111-emulator-5554.log'), 'first log\n');
      await fs.promises.writeFile(path.join(sourcePath, '2222-emulator-5556.log'), 'second log\n');
      await fs.promises.writeFile(path.join(sourcePath, '2222-emulator-5556.log.json'), '{}\n');

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
        fs.promises.readFile(path.join(destinationPath, '1111-emulator-5554.log'), 'utf-8')
      ).resolves.toBe('first log\n');
      await expect(
        fs.promises.readFile(path.join(destinationPath, '2222-emulator-5556.log'), 'utf-8')
      ).resolves.toBe('second log\n');
      await expect(
        fs.promises.access(path.join(destinationPath, '2222-emulator-5556.log.json'))
      ).rejects.toThrow();
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('collects streamed logcat output from a running emulator', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'collect-emulator-logs-'));
    const deviceName =
      `android-emulator-logcat-e2e-${randomUUID().slice(0, 8)}` as AndroidVirtualDeviceName;
    let emulatorPromise: Promise<unknown> | null = null;
    let serialId: AndroidDeviceSerialId | null = null;

    try {
      const logger = createMockLogger({ logToConsole: true });
      const buildLogsDirectory = path.join(tempDir, 'build-logs');
      const destinationPath = path.join(tempDir, 'maestro-tests', 'emulator-logs');
      const sourcePath = AndroidEmulatorUtils.getLogcatStagingDirectoryPath({ buildLogsDirectory });
      const marker = `ENG-20762-${randomUUID()}`;

      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
        deviceIdentifier: null,
        env: process.env,
        logger,
      });

      const startResult = await AndroidEmulatorUtils.startAsync({
        deviceName,
        env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
      });
      serialId = startResult.serialId;
      emulatorPromise = asyncResult(startResult.emulatorPromise);

      const streamResult = await AndroidEmulatorUtils.startLogcatStreamingAsync({
        serialId: startResult.serialId,
        outputDir: sourcePath,
        env: process.env,
        logger,
      });
      expect(streamResult).not.toBeNull();

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: startResult.serialId,
        env: process.env,
      });

      await spawn(
        'adb',
        ['-s', startResult.serialId, 'shell', 'log', '-t', 'EAS_CLI_TEST', marker],
        { env: process.env }
      );

      await retryAsync(
        async () => {
          const stagedLogFiles = (await fs.promises.readdir(sourcePath)).filter(entry =>
            entry.endsWith('.log')
          );
          expect(stagedLogFiles.length).toBeGreaterThan(0);
          const stagedLogPath = path.join(sourcePath, stagedLogFiles[0]);
          const contents = await fs.promises.readFile(stagedLogPath, 'utf-8');
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
