import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createCollectEmulatorLogsBuildFunction } from '../collectEmulatorLogs';

function createStep(callInputs?: Record<string, unknown>, envOverrides?: NodeJS.ProcessEnv) {
  const logger = createMockLogger();
  const fn = createCollectEmulatorLogsBuildFunction();
  const buildLogsDirectory =
    typeof envOverrides?.BUILD_LOGS_DIRECTORY === 'string'
      ? envOverrides.BUILD_LOGS_DIRECTORY
      : undefined;
  const globalCtx = createGlobalContextMock({ logger, buildLogsDirectory });
  globalCtx.updateEnv({ HOME: '/home/expo', ...envOverrides });
  const step = fn.createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
  });
  return Object.assign(step, { logger });
}

describe(createCollectEmulatorLogsBuildFunction, () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async temporaryDirectory => {
        await fs.promises.rm(temporaryDirectory, { force: true, recursive: true });
      })
    );
  });

  it('copies staged logs to the destination path', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    temporaryDirectories.push(buildLogsDirectory);
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const destinationPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'logcat-destination-')
    );
    temporaryDirectories.push(destinationPath);
    const logDirectory = path.join(sourcePath, 'EasAndroidDevice01-abc123');
    await fs.promises.mkdir(logDirectory, { recursive: true });
    const logPath = path.join(logDirectory, 'logcat.log');
    await fs.promises.writeFile(logPath, 'log line\n');

    await createStep(
      {
        destination_path: destinationPath,
      },
      {
        BUILD_LOGS_DIRECTORY: buildLogsDirectory,
      }
    ).executeAsync();

    await expect(
      fs.promises.readFile(path.join(destinationPath, 'EasAndroidDevice01-abc123.log'), 'utf-8')
    ).resolves.toBe('log line\n');
  });

  it('copies staged logs in parallel and skips metadata files', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    temporaryDirectories.push(buildLogsDirectory);
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const destinationPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'logcat-destination-')
    );
    temporaryDirectories.push(destinationPath);
    const firstLogDirectory = path.join(sourcePath, 'EasAndroidDevice01-abc123');
    const secondLogDirectory = path.join(sourcePath, 'eas-simulator-1-def456');
    await Promise.all([
      fs.promises.mkdir(firstLogDirectory, { recursive: true }),
      fs.promises.mkdir(secondLogDirectory, { recursive: true }),
    ]);
    await fs.promises.writeFile(path.join(firstLogDirectory, 'logcat.log'), 'first\n');
    await fs.promises.writeFile(path.join(secondLogDirectory, 'logcat.log'), 'second\n');
    await fs.promises.writeFile(path.join(secondLogDirectory, 'metadata.json'), '{}\n');

    const step = createStep(
      {
        destination_path: destinationPath,
      },
      {
        BUILD_LOGS_DIRECTORY: buildLogsDirectory,
      }
    );
    await expect(step.executeAsync()).resolves.toBeUndefined();
    await expect(
      fs.promises.readFile(path.join(destinationPath, 'EasAndroidDevice01-abc123.log'), 'utf-8')
    ).resolves.toBe('first\n');
    await expect(
      fs.promises.readFile(path.join(destinationPath, 'eas-simulator-1-def456.log'), 'utf-8')
    ).resolves.toBe('second\n');
    await expect(fs.promises.access(path.join(destinationPath, 'metadata.json'))).rejects.toThrow();
  });

  it('warns but does not fail when the staging directory is missing', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    temporaryDirectories.push(buildLogsDirectory);
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const destinationPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'logcat-destination-')
    );
    temporaryDirectories.push(destinationPath);
    const step = createStep(
      {
        destination_path: destinationPath,
      },
      {
        BUILD_LOGS_DIRECTORY: buildLogsDirectory,
      }
    );

    await expect(step.executeAsync()).resolves.toBeUndefined();
    expect(step.ctx.logger.warn).toHaveBeenCalledWith(
      `No Android emulator logcat staging directory found at ${sourcePath}.`
    );
  });
});
