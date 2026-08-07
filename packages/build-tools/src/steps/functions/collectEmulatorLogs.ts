import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import FastGlob from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';

import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';

export function createCollectEmulatorLogsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_emulator_logs',
    name: 'Collect Android emulator logs',
    __metricsId: 'eas/collect_emulator_logs',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'destination_path',
        required: false,
        defaultValue: '${{ env.HOME }}/.maestro/tests/emulator-logs',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ logger, global }, { inputs }) => {
      const sourcePath = AndroidEmulatorUtils.getLogcatStagingDirectoryPath({
        buildLogsDirectory: global.buildLogsDirectory,
      });
      const destinationPath = `${inputs.destination_path.value}`;

      await collectEmulatorLogsAsync({ sourcePath, destinationPath, logger });
    },
  });
}

async function collectEmulatorLogsAsync({
  sourcePath,
  destinationPath,
  logger,
}: {
  sourcePath: string;
  destinationPath: string;
  logger: bunyan;
}): Promise<void> {
  try {
    await fs.promises.access(sourcePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      logger.warn(`No Android emulator logcat staging directory found at ${sourcePath}.`);
      return;
    }
    logger.warn({ err }, `Failed to read Android emulator logcat staging directory ${sourcePath}.`);
    return;
  }

  let logFiles: string[];
  try {
    logFiles = await FastGlob('**/*.log', {
      absolute: true,
      cwd: sourcePath,
      followSymbolicLinks: false,
      onlyFiles: true,
    });
  } catch (err) {
    logger.warn({ err }, `Failed to find Android emulator logcat files at ${sourcePath}.`);
    return;
  }
  if (logFiles.length === 0) {
    logger.warn(`No Android emulator logcat files found at ${sourcePath}.`);
    return;
  }

  try {
    await fs.promises.mkdir(destinationPath, { recursive: true });
  } catch (err) {
    logger.warn({ err }, `Failed to create Android emulator log destination ${destinationPath}.`);
    return;
  }

  const copyResults = await Promise.all(
    logFiles.map(async sourceFilePath => {
      const stagingDirectoryName = path.basename(path.dirname(sourceFilePath));
      const destinationFilePath = path.join(destinationPath, `${stagingDirectoryName}.log`);
      try {
        await fs.promises.copyFile(sourceFilePath, destinationFilePath);
        return true;
      } catch (err) {
        logger.warn({ err }, `Failed to copy Android emulator log ${sourceFilePath}.`);
        return false;
      }
    })
  );
  const copiedCount = copyResults.filter(Boolean).length;

  logger.info(`Collected ${copiedCount} Android emulator logcat file(s) to ${destinationPath}.`);
}
