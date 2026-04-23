import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
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
});
