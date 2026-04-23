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
  it('copies staged logs to the destination path', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const destinationPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'logcat-destination-')
    );
    await fs.promises.mkdir(sourcePath, { recursive: true });
    const logPath = path.join(sourcePath, 'emulator-5554.log');
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
      fs.promises.readFile(path.join(destinationPath, 'emulator-5554.log'), 'utf-8')
    ).resolves.toBe('log line\n');
  });

  it('copies staged logs in parallel and skips metadata files', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const destinationPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'logcat-destination-')
    );
    await fs.promises.mkdir(sourcePath, { recursive: true });
    await fs.promises.writeFile(path.join(sourcePath, '1234-emulator-5554.log'), 'first\n');
    await fs.promises.writeFile(path.join(sourcePath, '5678-emulator-5556.log'), 'second\n');
    await fs.promises.writeFile(path.join(sourcePath, '5678-emulator-5556.log.json'), '{}\n');

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
      fs.promises.readFile(path.join(destinationPath, '1234-emulator-5554.log'), 'utf-8')
    ).resolves.toBe('first\n');
    await expect(
      fs.promises.readFile(path.join(destinationPath, '5678-emulator-5556.log'), 'utf-8')
    ).resolves.toBe('second\n');
    await expect(
      fs.promises.access(path.join(destinationPath, '5678-emulator-5556.log.json'))
    ).rejects.toThrow();
  });

  it('warns but does not fail when the staging directory is missing', async () => {
    const buildLogsDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'build-logs-'));
    const sourcePath = path.join(buildLogsDirectory, 'android-emulator-logcat');
    const step = createStep(
      {
        destination_path: await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-destination-')),
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
