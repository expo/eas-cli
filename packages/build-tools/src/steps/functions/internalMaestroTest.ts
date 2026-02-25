import { GenericArtifactType } from '@expo/eas-build-job';
import { PipeMode, bunyan } from '@expo/logger';
import { Result, asyncResult, result } from '@expo/results';
import {
  BuildFunction,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
  spawnAsync,
} from '@expo/steps';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import {
  AndroidDeviceSerialId,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';
import { IosSimulatorName, IosSimulatorUtils } from '../../utils/IosSimulatorUtils';
import { findMaestroPathsFlowsToExecuteAsync } from '../../utils/findMaestroPathsFlowsToExecuteAsync';
import { PlatformToProperNounMap } from '../../utils/strings';

export function createInternalEasMaestroTestFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: '__maestro_test',
    __metricsId: 'eas/__maestro_test',
    inputProviders: [
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'platform',
        required: true,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        id: 'flow_paths',
        required: true,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        id: 'retries',
        defaultValue: 1,
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'include_tags',
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'exclude_tags',
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        id: 'shards',
        defaultValue: 1,
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'output_format',
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        id: 'record_screen',
        defaultValue: false,
        required: false,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'test_reports_artifact_id',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'junit_report_directory',
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs: _inputs, env, outputs }) => {
      // inputs come in form of { value: unknown }. Here we parse them into a typed and validated object.
      const {
        platform,
        flow_paths,
        retries,
        include_tags,
        exclude_tags,
        shards,
        output_format,
        record_screen,
      } = z
        .object({
          platform: z.enum(['ios', 'android']),
          flow_paths: z.array(z.string()),
          retries: z.number().default(1),
          include_tags: z.string().optional(),
          exclude_tags: z.string().optional(),
          shards: z.number().default(1),
          output_format: z.string().optional(),
          record_screen: z.boolean().default(false),
        })
        .parse(
          Object.fromEntries(Object.entries(_inputs).map(([key, value]) => [key, value.value]))
        );

      const flowPathsToExecute: string[] = [];
      for (const flowPath of flow_paths) {
        const flowPaths = await findMaestroPathsFlowsToExecuteAsync({
          workingDirectory: stepCtx.workingDirectory,
          flowPath,
          logger: stepCtx.logger,
          includeTags: include_tags ? include_tags.split(',') : undefined,
          excludeTags: exclude_tags ? exclude_tags.split(',') : undefined,
        });
        if (flowPaths.length === 0) {
          stepCtx.logger.warn(`No flows to execute found in "${flowPath}".`);
          continue;
        }
        stepCtx.logger.info(
          `Marking for execution:\n- ${flowPaths
            .map(flowPath => path.relative(stepCtx.workingDirectory, flowPath))
            .join('\n- ')}`
        );
        stepCtx.logger.info('');
        flowPathsToExecute.push(...flowPaths);
      }

      // TODO: Add support for shards. (Shouldn't be too difficult.)
      if (shards > 1) {
        stepCtx.logger.warn(
          'Sharding support has been temporarily disabled. Running tests on a single shard.'
        );
      }

      // eas/__maestro_test does not start devices, it expects a single device to be already running
      // and configured with the app. Here we find the booted device and stop it.

      let sourceDeviceIdentifier: IosSimulatorName | AndroidVirtualDeviceName;

      switch (platform) {
        case 'ios': {
          const bootedDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
            env,
            filter: 'booted',
          });
          if (bootedDevices.length === 0) {
            throw new Error('No booted iOS Simulator found.');
          } else if (bootedDevices.length > 1) {
            throw new Error('Multiple booted iOS Simulators found.');
          }

          const device = bootedDevices[0];
          stepCtx.logger.info(`Running tests on iOS Simulator: ${device.name}.`);

          stepCtx.logger.info(`Preparing Simulator for tests...`);
          await spawnAsync('xcrun', ['simctl', 'shutdown', device.udid], {
            logger: stepCtx.logger,
            stdio: 'pipe',
          });

          sourceDeviceIdentifier = device.name;
          break;
        }
        case 'android': {
          const connectedDevices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env });
          if (connectedDevices.length === 0) {
            throw new Error('No booted Android Emulator found.');
          } else if (connectedDevices.length > 1) {
            throw new Error('Multiple booted Android Emulators found.');
          }

          const { serialId } = connectedDevices[0];
          const adbEmuAvdNameResult = await spawn('adb', ['-s', serialId, 'emu', 'avd', 'name'], {
            mode: PipeMode.COMBINED,
            env,
          });
          const avdName = adbEmuAvdNameResult.stdout
            .replace(/\r\n/g, '\n')
            .split('\n')[0] as AndroidVirtualDeviceName;
          stepCtx.logger.info(`Running tests on Android Emulator: ${avdName}.`);

          stepCtx.logger.info(`Preparing Emulator for tests...`);
          await spawnAsync('adb', ['-s', serialId, 'emu', 'kill'], {
            stdio: 'pipe',
          });
          // Waiting for emulator to get killed, see ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL.
          await setTimeout(1000);

          sourceDeviceIdentifier = avdName;
          break;
        }
      }

      // During tests we generate reports and device logs. We store them in temporary directories
      // and upload them once all tests are done. When a test is retried, new reports overwrite
      // the old ones. The files are named "flow-${index}" for easier identification.
      const maestroReportsDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'maestro-reports-')
      );
      const deviceLogsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'device-logs-'));

      const failedFlows: string[] = [];

      for (const [flowIndex, flowPath] of flowPathsToExecute.entries()) {
        stepCtx.logger.info('');

        // If output_format is empty or noop, we won't use this.
        const outputPath = path.join(
          maestroReportsDir,
          [
            `${output_format ? output_format + '-' : ''}report-flow-${flowIndex + 1}`,
            MaestroOutputFormatToExtensionMap[output_format ?? 'noop'],
          ]
            .filter(Boolean)
            .join('.')
        );

        for (let attemptCount = 0; attemptCount < retries; attemptCount++) {
          const localDeviceName = `eas-simulator-${flowIndex}-${attemptCount}` as
            | IosSimulatorName
            | AndroidVirtualDeviceName;

          // If the test passes, but the recording fails, we don't want to make the test fail,
          // so we return two separate results.
          const {
            fnResult: { fnResult, recordingResult },
            logsResult,
          } = await withCleanDeviceAsync({
            platform,
            sourceDeviceIdentifier,
            localDeviceName,
            env,
            logger: stepCtx.logger,
            fn: async ({ deviceIdentifier }) => {
              return await maybeWithScreenRecordingAsync({
                shouldRecord: record_screen,
                platform,
                deviceIdentifier,
                env,
                logger: stepCtx.logger,
                fn: async () => {
                  stepCtx.logger.info('');

                  const [command, ...args] = getMaestroTestCommand({
                    flow_path: flowPath,
                    output_format,
                    output_path: outputPath,
                  });

                  try {
                    await spawnAsync(command, args, {
                      logger: stepCtx.logger,
                      cwd: stepCtx.workingDirectory,
                      env,
                      stdio: 'pipe',
                    });
                  } finally {
                    stepCtx.logger.info('');
                  }
                },
              });
            },
          });

          // Move device logs to the device logs directory.
          if (logsResult?.ok) {
            try {
              const extension = path.extname(logsResult.value.outputPath);
              const destinationPath = path.join(deviceLogsDir, `flow-${flowIndex}${extension}`);

              await fs.promises.rm(destinationPath, {
                force: true,
                recursive: true,
              });
              await fs.promises.rename(logsResult.value.outputPath, destinationPath);
            } catch (err) {
              stepCtx.logger.warn({ err }, 'Failed to prepare device logs for upload.');
            }
          } else if (logsResult?.reason) {
            stepCtx.logger.error({ err: logsResult.reason }, 'Failed to collect device logs.');
          }

          const isLastAttempt = fnResult.ok || attemptCount === retries - 1;
          if (isLastAttempt && recordingResult.value) {
            try {
              await ctx.runtimeApi.uploadArtifact({
                logger: stepCtx.logger,
                artifact: {
                  // TODO(sjchmiela): Add metadata to artifacts so we don't need to encode flow path and attempt in the name.
                  name: `Screen Recording (${flowIndex}-${path.basename(
                    flowPath,
                    path.extname(flowPath)
                  )})`,
                  paths: [recordingResult.value],
                  type: GenericArtifactType.OTHER,
                },
              });
            } catch (err) {
              stepCtx.logger.warn({ err }, 'Failed to upload screen recording.');
            }
          }

          if (fnResult.ok) {
            stepCtx.logger.info(`Test passed.`);
            // Break out of the retry loop.
            break;
          }

          if (attemptCount < retries - 1) {
            stepCtx.logger.info(`Retrying test...`);
            stepCtx.logger.info('');
            continue;
          }

          // fnResult.reason is not super interesting, but it does print out the full command so we can keep it for debugging purposes.
          stepCtx.logger.error({ err: fnResult.reason }, 'Test errored.');
          failedFlows.push(flowPath);
        }
      }

      stepCtx.logger.info('');

      // When all tests are done, we upload the reports and device logs.
      const generatedMaestroReports = await fs.promises.readdir(maestroReportsDir);
      if (generatedMaestroReports.length === 0) {
        stepCtx.logger.warn('No reports were generated.');
      } else {
        stepCtx.logger.info(`Uploading reports...`);
        try {
          const { artifactId } = await ctx.runtimeApi.uploadArtifact({
            logger: stepCtx.logger,
            artifact: {
              name: `${PlatformToProperNounMap[platform]} Maestro Test Reports (${output_format})`,
              paths: [maestroReportsDir],
              type: GenericArtifactType.OTHER,
            },
          });
          if (artifactId) {
            outputs.test_reports_artifact_id.set(artifactId);
          }
        } catch (err) {
          stepCtx.logger.error({ err }, 'Failed to upload reports.');
        }
      }

      if (output_format === 'junit') {
        outputs.junit_report_directory.set(maestroReportsDir);
      }

      const generatedDeviceLogs = await fs.promises.readdir(deviceLogsDir);
      if (generatedDeviceLogs.length === 0) {
        stepCtx.logger.warn('No device logs were successfully collected.');
      } else {
        stepCtx.logger.info(`Uploading device logs...`);
        try {
          await ctx.runtimeApi.uploadArtifact({
            logger: stepCtx.logger,
            artifact: {
              name: `Maestro Test Device Logs`,
              paths: [deviceLogsDir],
              type: GenericArtifactType.OTHER,
            },
          });
        } catch (err) {
          stepCtx.logger.error({ err }, 'Failed to upload device logs.');
        }
      }

      stepCtx.logger.info('');

      // If any tests failed, we throw an error to mark the step as failed.
      if (failedFlows.length > 0) {
        throw new Error(
          `Some Maestro tests failed:\n- ${failedFlows
            .map(flowPath => path.relative(stepCtx.workingDirectory, flowPath))
            .join('\n- ')}`
        );
      } else {
        stepCtx.logger.info('All Maestro tests passed.');
      }
    },
  });
}

export function getMaestroTestCommand(params: {
  flow_path: string;
  output_format: string | undefined;
  /** Unused if `output_format` is undefined */
  output_path: string;
}): [command: string, ...args: string[]] {
  let outputFormatFlags: string[] = [];
  if (params.output_format) {
    outputFormatFlags = [`--format`, params.output_format, `--output`, params.output_path];
  }

  return ['maestro', 'test', ...outputFormatFlags, params.flow_path] as [
    command: string,
    ...args: string[],
  ];
}

const MaestroOutputFormatToExtensionMap: Record<string, string | undefined> = {
  junit: 'xml',
  html: 'html',
};

async function withCleanDeviceAsync<TResult>({
  platform,
  sourceDeviceIdentifier,
  localDeviceName,
  env,
  logger,
  fn,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  platform: 'ios' | 'android';
  sourceDeviceIdentifier: IosSimulatorName | AndroidVirtualDeviceName;
  localDeviceName: IosSimulatorName | AndroidVirtualDeviceName;
  fn: ({
    deviceIdentifier,
  }: {
    deviceIdentifier: IosSimulatorName | AndroidDeviceSerialId;
  }) => Promise<TResult>;
}): Promise<{ fnResult: TResult; logsResult: Result<{ outputPath: string }> | null }> {
  // Clone and start the device

  let localDeviceIdentifier: IosSimulatorName | AndroidDeviceSerialId;

  switch (platform) {
    case 'ios': {
      logger.info(`Cloning iOS Simulator ${sourceDeviceIdentifier} to ${localDeviceName}...`);
      await IosSimulatorUtils.cloneAsync({
        sourceDeviceIdentifier: sourceDeviceIdentifier as IosSimulatorName,
        destinationDeviceName: localDeviceName as IosSimulatorName,
        env,
      });
      logger.info(`Starting iOS Simulator ${localDeviceName}...`);
      const { udid } = await IosSimulatorUtils.startAsync({
        deviceIdentifier: localDeviceName as IosSimulatorName,
        env,
      });
      logger.info(`Waiting for iOS Simulator ${localDeviceName} to be ready...`);
      await IosSimulatorUtils.waitForReadyAsync({
        udid,
        env,
      });
      localDeviceIdentifier = localDeviceName as IosSimulatorName;
      break;
    }
    case 'android': {
      logger.info(`Cloning Android Emulator ${sourceDeviceIdentifier} to ${localDeviceName}...`);
      await AndroidEmulatorUtils.cloneAsync({
        sourceDeviceName: sourceDeviceIdentifier as AndroidVirtualDeviceName,
        destinationDeviceName: localDeviceName as AndroidVirtualDeviceName,
        env,
        logger,
      });
      logger.info(`Starting Android Emulator ${localDeviceName}...`);
      const { serialId } = await AndroidEmulatorUtils.startAsync({
        deviceName: localDeviceName as AndroidVirtualDeviceName,
        env,
      });
      logger.info(`Waiting for Android Emulator ${localDeviceName} to be ready...`);
      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId,
        env,
      });
      localDeviceIdentifier = serialId;
      break;
    }
  }

  // Run the function

  const fnResult = await asyncResult(fn({ deviceIdentifier: localDeviceIdentifier }));

  // Stop the device

  let logsResult: Result<{ outputPath: string }> | null = null;

  try {
    switch (platform) {
      case 'ios': {
        logger.info(`Collecting logs from ${localDeviceName}...`);
        logsResult = await asyncResult(
          IosSimulatorUtils.collectLogsAsync({
            deviceIdentifier: localDeviceIdentifier as IosSimulatorName,
            env,
          })
        );

        logger.info(`Cleaning up ${localDeviceName}...`);
        await IosSimulatorUtils.deleteAsync({
          deviceIdentifier: localDeviceIdentifier as IosSimulatorName,
          env,
        });
        break;
      }
      case 'android': {
        logger.info(`Collecting logs from ${localDeviceName}...`);
        logsResult = await asyncResult(
          AndroidEmulatorUtils.collectLogsAsync({
            serialId: localDeviceIdentifier as AndroidDeviceSerialId,
            env,
          })
        );

        logger.info(`Cleaning up ${localDeviceName}...`);
        await AndroidEmulatorUtils.deleteAsync({
          serialId: localDeviceIdentifier as AndroidDeviceSerialId,
          env,
        });
        break;
      }
    }
  } catch (err) {
    logger.error(`Error cleaning up device: ${err}`);
  }

  return { fnResult: fnResult.enforceValue(), logsResult };
}

/** Runs provided `fn` function, optionally wrapping it with starting and stopping screen recording. */
async function maybeWithScreenRecordingAsync<TResult>({
  shouldRecord,
  platform,
  deviceIdentifier,
  env,
  logger,
  fn,
}: {
  // As weird as it is, it's more convenient to have this function like `maybeWith...`
  // than "withScreenRecordingAsync" and `withScreenRecordingAsync(fn)` vs `fn` in the caller.
  shouldRecord: boolean;
  platform: 'ios' | 'android';
  deviceIdentifier: IosSimulatorName | AndroidDeviceSerialId;
  env: BuildStepEnv;
  logger: bunyan;
  fn: () => Promise<TResult>;
}): Promise<{ fnResult: Result<TResult>; recordingResult: Result<string | null> }> {
  if (!shouldRecord) {
    return { fnResult: await asyncResult(fn()), recordingResult: result(null) };
  }

  let recordingResult: Result<{
    recordingSpawn: SpawnPromise<SpawnResult>;
    outputPath?: string;
  }>;

  // Start screen recording

  logger.info(`Starting screen recording on ${deviceIdentifier}...`);

  switch (platform) {
    case 'ios': {
      recordingResult = await asyncResult(
        IosSimulatorUtils.startScreenRecordingAsync({
          deviceIdentifier: deviceIdentifier as IosSimulatorName,
          env,
        })
      );
      break;
    }
    case 'android': {
      recordingResult = await asyncResult(
        AndroidEmulatorUtils.startScreenRecordingAsync({
          serialId: deviceIdentifier as AndroidDeviceSerialId,
          env,
        })
      );
      break;
    }
  }

  if (!recordingResult.ok) {
    logger.warn('Failed to start screen recording.', recordingResult.reason);
  }

  // Run the function

  const fnResult = await asyncResult(fn());

  // If recording failed there's nothing to stop, so we return the results

  if (!recordingResult.ok) {
    return { fnResult, recordingResult: result(recordingResult.reason) };
  }

  // If recording started, finish it

  try {
    logger.info(`Stopping screen recording on ${deviceIdentifier}...`);

    switch (platform) {
      case 'ios': {
        await IosSimulatorUtils.stopScreenRecordingAsync({
          recordingSpawn: recordingResult.value.recordingSpawn,
        });
        return {
          fnResult,
          // We know outputPath is defined, because startIosScreenRecording() should have filled it.
          recordingResult: result(recordingResult.value.outputPath!),
        };
      }
      case 'android': {
        const { outputPath } = await AndroidEmulatorUtils.stopScreenRecordingAsync({
          serialId: deviceIdentifier as AndroidDeviceSerialId,
          recordingSpawn: recordingResult.value.recordingSpawn,
          env,
        });
        return { fnResult, recordingResult: result(outputPath) };
      }
    }
  } catch (err) {
    logger.warn('Failed to stop screen recording.', err);

    return { fnResult, recordingResult: result(err as Error) };
  }
}
