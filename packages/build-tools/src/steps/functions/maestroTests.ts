import { GenericArtifactType, SystemError, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import { MaestroBackend, resolveMaestroBackend } from './maestroBackend';
import { buildFlowNameToPathMap } from './maestroFlowDiscovery';
import {
  copyLatestAttemptXml,
  junitFileHasFileAttrs,
  mergeJUnitReports,
  parseFailedFlowNamesFromJUnitFile,
  parseFailedFlowsFromFileAttrs,
  parseFailedFlowsFromJUnit,
  parseFailedFlowsFromMaestroRunnerReport,
  parseJUnitTestCases,
  parseMaestroRunnerReport,
} from './maestroResultParser';
import {
  type HarvestedScreenshot,
  computePureFailureFlowNames,
  harvestFailureScreenshotsAsync,
  harvestMaestroRunnerFailureScreenshotsAsync,
  selectFailureScreenshots,
} from './maestroScreenshots';
import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';

const FlowPathSchema = z.array(z.string().min(1)).min(1);
const RetriesSchema = z.number().int().min(0).default(0);
const ShardsSchema = z.number().int().min(1).optional();
const AndroidConnectionModeSchema = z.enum(['adb', 'dadb']).default('adb');

function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  message: string
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new UserError('ERR_MAESTRO_INVALID_INPUT', message, { cause: result.error });
  }
  return result.data;
}

// ENOENT is excluded — "input XML missing" is a data issue, not a storage
// fault, so the post-loop merge should fall through to copy-latest instead
// of throwing.
function isFilesystemError(err: any): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = err.code;
  return (
    code === 'ENOSPC' || code === 'EACCES' || code === 'EROFS' || code === 'EIO' || code === 'EPERM'
  );
}

function buildMaestroArgs({
  backend,
  platform,
  flowPaths,
  output,
  outputFormat,
  shards,
  includeTags,
  excludeTags,
}: {
  backend: MaestroBackend;
  platform: 'ios' | 'android';
  flowPaths: string[];
  output: string | null;
  outputFormat: string | undefined;
  shards: number | undefined;
  includeTags: string | undefined;
  excludeTags: string | undefined;
}): { executable: MaestroBackend; args: string[] } {
  switch (backend) {
    case 'maestro': {
      const args = ['test'];
      if (outputFormat) {
        args.push(`--format=${outputFormat.toUpperCase()}`);
      }
      if (output) {
        args.push(`--output=${output}`);
      }
      if (shards !== undefined) {
        args.push(`--shard-split=${shards}`);
      }
      if (includeTags) {
        args.push(`--include-tags=${includeTags}`);
      }
      if (excludeTags) {
        args.push(`--exclude-tags=${excludeTags}`);
      }
      args.push(...flowPaths);
      return { executable: 'maestro', args };
    }
    case 'maestro-runner': {
      // The runner writes every report format to one directory. output_format only
      // selects which extra report artifact EAS uploads after the test.
      const args = [`--platform=${platform}`, 'test', `--output=${output}`, '--flatten'];
      if (shards !== undefined && shards > 1) {
        args.push(`--parallel=${shards}`);
      }
      if (includeTags) {
        args.push(`--include-tags=${includeTags}`);
      }
      if (excludeTags) {
        args.push(`--exclude-tags=${excludeTags}`);
      }
      args.push(...flowPaths);
      return { executable: 'maestro-runner', args };
    }
  }
}

export function createMaestroTestsBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'maestro_tests',
    name: 'Run Maestro Tests',
    __metricsId: 'eas/maestro_tests',
    __hookId: 'maestro_tests',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'flow_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'retries',
        required: false,
        defaultValue: 0,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'retry_failed_only',
        required: false,
        defaultValue: true,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
      BuildStepInput.createProvider({
        id: 'shards',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'include_tags',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'exclude_tags',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'output_format',
        required: false,
        defaultValue: 'junit',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'platform',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'android_connection_mode',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'backend',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({ id: 'junit_report_directory', required: true }),
      BuildStepOutput.createProvider({ id: 'final_report_path', required: false }),
      BuildStepOutput.createProvider({ id: 'tests_directory', required: true }),
    ],
    fn: async (stepCtx, { inputs, outputs, env, signal }) => {
      const { logger, global } = stepCtx;
      const platformInput = inputs.platform.value as string | undefined;
      const outputFormat = (inputs.output_format.value as string | undefined)?.toLowerCase();
      const includeTags = inputs.include_tags.value as string | undefined;
      const excludeTags = inputs.exclude_tags.value as string | undefined;

      const platform: 'ios' | 'android' =
        platformInput === 'ios' || platformInput === 'android'
          ? platformInput
          : global.runtimePlatform === BuildRuntimePlatform.DARWIN
            ? 'ios'
            : 'android';

      // Paths derive from env.HOME (not os.homedir()). Maestro is spawned with
      // this env and writes debug output under $HOME/.maestro/tests; the step
      // must read from the same place or stale files leak across runs.
      const home = env.HOME;
      if (!home) {
        throw new SystemError('HOME env var is not set');
      }
      const testsDirectory = path.join(home, '.maestro', 'tests');
      const junitReportDirectory = path.join(testsDirectory, 'junit-reports');
      const junitFinalReportPath = path.join(testsDirectory, `${platform}-maestro-junit.xml`);

      // Public docs (EAS workflows pre-packaged-jobs) document
      // `${MAESTRO_TESTS_DIR}` for users to save screenshots/recordings into
      // the uploaded dir.
      const spawnEnv: NodeJS.ProcessEnv = { ...env, MAESTRO_TESTS_DIR: testsDirectory };

      // Publish known paths before backend validation so `if: always()` upload
      // steps can use them after an early failure. final_report_path names the
      // report selected by output_format, not every report the backend produces.
      outputs.tests_directory.set(testsDirectory);
      outputs.junit_report_directory.set(junitReportDirectory);
      if (outputFormat === 'junit') {
        outputs.final_report_path.set(junitFinalReportPath);
      }

      // Resolved after the output assignments above: an invalid backend input or
      // EAS_MAESTRO_BACKEND throws, and downstream `if: always()` upload steps still
      // need the outputs interpolated.
      const backend = resolveMaestroBackend({
        input: inputs.backend.value,
        env,
      });
      // The runner can write JUnit regardless of output_format; Maestro CLI only
      // writes it when JUnit is selected. Either command may fail before it writes a file.
      const mayHaveJUnitReports = backend === 'maestro-runner' || outputFormat === 'junit';
      const maestroCliOutputPath =
        backend === 'maestro' && outputFormat && outputFormat !== 'junit'
          ? path.join(testsDirectory, `${platform}-maestro-${outputFormat}.${outputFormat}`)
          : null;
      if (backend === 'maestro' && outputFormat === 'html' && maestroCliOutputPath) {
        outputs.final_report_path.set(maestroCliOutputPath);
      }

      const flowPaths = parseInput(
        FlowPathSchema,
        inputs.flow_path.value,
        'flow_path must be a non-empty array of non-empty strings.'
      );
      const retries = parseInput(
        RetriesSchema,
        inputs.retries.value,
        'retries must be a non-negative integer.'
      );
      const shards = parseInput(
        ShardsSchema,
        inputs.shards.value,
        'shards must be a positive integer.'
      );
      const androidConnectionMode = parseInput(
        AndroidConnectionModeSchema,
        inputs.android_connection_mode.value ||
          env.EAS_MAESTRO_ANDROID_CONNECTION_MODE ||
          undefined,
        'android_connection_mode and EAS_MAESTRO_ANDROID_CONNECTION_MODE must be either "adb" or "dadb".'
      );
      if (
        backend === 'maestro-runner' &&
        outputFormat !== undefined &&
        !['junit', 'html', 'allure'].includes(outputFormat)
      ) {
        throw new UserError(
          'ERR_MAESTRO_INVALID_INPUT',
          `maestro-runner supports "junit", "html", and "allure" output_format values, but received "${outputFormat}".`
        );
      }
      const retryFailedOnly = inputs.retry_failed_only.value as boolean;

      try {
        await fs.mkdir(junitReportDirectory, { recursive: true });
      } catch (err) {
        throw new SystemError('Failed to create JUnit report directory', { cause: err });
      }

      // Official Maestro legacy-only (Maestro < 2.6.0 reports carry no `file=` attribute): the
      // flow scan is built lazily in the retry branch below and memoized so
      // retries share one scan. Never runs when the report has `file=`.
      let nameToPathPromise: Promise<Map<string, string> | null> | undefined;

      // Retry loop. spawn-async error shapes:
      //   ENOENT/EACCES → infra (binary missing/not executable) → SystemError.
      //   numeric err.status → maestro exited non-zero → retry.
      //   else (signal-only, OOM kill, unknown) → infra → SystemError, never
      //     downgraded to "tests failed".
      // Retry-failed-only: after a failed attempt, subset to the failing flows. The
      // failed-flow parsers return null when a report cannot be trusted; we then fall
      // through to dumb retry (re-run everything).
      let flowsToRun: string[] = flowPaths;
      let lastAttemptExitCode: number | null = null;
      const harvested: HarvestedScreenshot[] = [];
      const reportDirectories = backend === 'maestro' ? [junitReportDirectory] : [];

      const totalAttempts = retries + 1;
      if (
        backend === 'maestro-runner' &&
        platform === 'android' &&
        androidConnectionMode === 'dadb'
      ) {
        logger.info('maestro-runner does not support DADB. Using the default ADB connection.');
      }
      if (backend === 'maestro' && platform === 'android' && androidConnectionMode === 'dadb') {
        try {
          const adbOverrideDirectoryPath = await fs.mkdtemp(
            path.join(os.tmpdir(), 'maestro-tests-adb-override-')
          );
          await fs.writeFile(path.join(adbOverrideDirectoryPath, 'adb'), '#!/bin/sh\nexit 1\n', {
            mode: 0o755,
          });

          // DADB starts an ADB server when it can find an adb binary. Stop the existing
          // server first, then make only the Maestro process find the failing shim.
          try {
            await spawn('adb', ['kill-server'], { env: { ...spawnEnv }, logger, signal });
            logger.info(
              'Using a direct DADB connection for Android Maestro tests after stopping the ADB server.'
            );
          } catch (err) {
            logger.warn(
              { err },
              'Using a direct DADB connection for Android Maestro tests, but failed to stop the ADB server.'
            );
          }
          spawnEnv.PATH = spawnEnv.PATH
            ? `${adbOverrideDirectoryPath}${path.delimiter}${spawnEnv.PATH}`
            : adbOverrideDirectoryPath;
        } catch (err) {
          // Intentionally skip cleanup because the worker is disposable.
          throw new SystemError('Failed to enable direct DADB connection for Maestro', {
            cause: err,
          });
        }
        // Do not restart ADB or remove the override. This keeps Maestro in direct DADB mode.
      }

      for (let attempt = 0; attempt <= retries; attempt++) {
        // maestro-runner writes all report formats and screenshot metadata here.
        const runnerOutputDirectory = path.join(
          testsDirectory,
          `${platform}-maestro-runner-attempt-${attempt}`
        );
        const outputPath = mayHaveJUnitReports
          ? path.join(junitReportDirectory, `${platform}-maestro-junit-attempt-${attempt}.xml`)
          : maestroCliOutputPath;
        const { executable, args: maestroArgs } = buildMaestroArgs({
          backend,
          platform,
          flowPaths: flowsToRun,
          output: backend === 'maestro-runner' ? runnerOutputDirectory : outputPath,
          outputFormat,
          shards,
          includeTags,
          excludeTags,
        });
        logger.info(
          `Running ${executable} (attempt ${attempt + 1}/${totalAttempts}): ${executable} ${maestroArgs.join(' ')}`
        );

        // The runner output directory is deterministic and can survive a prior run; clear it
        // best-effort so a crash before it writes fresh output can't resurrect stale results.
        if (backend === 'maestro-runner') {
          try {
            await fs.rm(runnerOutputDirectory, { recursive: true, force: true });
          } catch (err) {
            logger.warn({ err }, `Failed to clear ${runnerOutputDirectory} before the attempt.`);
          }
        }

        const attemptStartedAtMs = Date.now();

        try {
          await spawn(executable, maestroArgs, {
            cwd: stepCtx.workingDirectory,
            env: spawnEnv,
            logger,
            signal,
          });
          lastAttemptExitCode = 0;
        } catch (err: any) {
          if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
            throw new SystemError(`Failed to invoke ${executable}`, { cause: err });
          }
          if (err && typeof err.status === 'number') {
            lastAttemptExitCode = err.status;
          } else {
            throw new SystemError(`Unexpected spawn failure invoking ${executable}`, {
              cause: err,
            });
          }
        }

        // maestro-runner writes a report directory. Copy its JUnit file into the existing
        // per-attempt directory so retry parsing and final report merging remain shared.
        if (backend === 'maestro-runner' && outputPath) {
          try {
            await fs.copyFile(path.join(runnerOutputDirectory, 'junit-report.xml'), outputPath);
          } catch (err: any) {
            logger.warn(
              { err },
              `Failed to collect the maestro-runner JUnit report for attempt ${attempt + 1}.`
            );
          }
        }

        if (backend === 'maestro-runner') {
          reportDirectories.push(runnerOutputDirectory);
        }

        // Harvest failure screenshots before retry subsetting when JUnit results are available.
        if (mayHaveJUnitReports) {
          let screenshots: HarvestedScreenshot[];
          switch (backend) {
            case 'maestro': {
              const failedFlowNames = outputPath
                ? await parseFailedFlowNamesFromJUnitFile(outputPath)
                : new Set<string>();
              screenshots = await harvestFailureScreenshotsAsync({
                testsDirectory,
                capturedSinceMs: attemptStartedAtMs,
                attemptIndex: attempt,
                failedFlowNames,
                logger,
              });
              break;
            }
            case 'maestro-runner':
              screenshots = await harvestMaestroRunnerFailureScreenshotsAsync({
                reportDirectory: runnerOutputDirectory,
                capturedSinceMs: attemptStartedAtMs,
                attemptIndex: attempt,
                logger,
              });
              break;
          }
          harvested.push(...screenshots);
        }

        if (lastAttemptExitCode === 0 || attempt === retries) {
          break;
        }

        if (
          retryFailedOnly &&
          (backend === 'maestro-runner' || (outputFormat === 'junit' && outputPath))
        ) {
          let failed: string[] | null;
          switch (backend) {
            case 'maestro-runner':
              failed = await parseFailedFlowsFromMaestroRunnerReport({
                reportDirectory: runnerOutputDirectory,
                workingDirectory: stepCtx.workingDirectory,
              });
              break;
            case 'maestro':
              if (!outputPath) {
                failed = null;
                break;
              }
              if (await junitFileHasFileAttrs(outputPath)) {
                failed = await parseFailedFlowsFromFileAttrs({
                  junitFile: outputPath,
                  workingDirectory: stepCtx.workingDirectory,
                });
                break;
              }
              // Legacy (Maestro < 2.6.0): map failed testcase names back to flow
              // paths via the flow-file scan. DELETE this arm once the fleet is
              // on >= 2.6.0.
              const nameToPath = await (nameToPathPromise ??= buildFlowNameToPathMap({
                inputFlowPaths: flowPaths,
                projectRoot: stepCtx.workingDirectory,
                logger,
              }));
              failed = nameToPath
                ? await parseFailedFlowsFromJUnit({
                    junitFile: outputPath,
                    nameToPath,
                  })
                : null;
              break;
          }
          if (failed !== null && failed.length > 0) {
            flowsToRun = failed;
            logger.info(
              `Test failed; retrying ${failed.length} failed flow(s): ${failed.join(', ')}`
            );
          } else {
            flowsToRun = flowPaths;
            logger.info('Test failed; could not determine failed subset, retrying all flows');
          }
        } else {
          flowsToRun = flowPaths;
          logger.info('Test failed, retrying all flows');
        }

        await sleepAsync(2000);
      }

      // Only JUnit is merged into final_report_path. Runner HTML/Allure keeps its
      // per-attempt JUnit files, but final_report_path names the selected report.
      // On data errors (bad XML, missing input), fall back to copy-latest.
      // Filesystem errors short-circuit straight to SystemError.
      if (outputFormat === 'junit') {
        try {
          await mergeJUnitReports({
            sourceDir: junitReportDirectory,
            outputPath: junitFinalReportPath,
          });
        } catch (mergeErr: any) {
          if (isFilesystemError(mergeErr)) {
            throw new SystemError('Failed to write final_report_path', { cause: mergeErr });
          }
          logger.warn({ err: mergeErr }, 'Smart merge failed; falling back to copy-latest.');
          try {
            await copyLatestAttemptXml({
              sourceDir: junitReportDirectory,
              outputPath: junitFinalReportPath,
            });
          } catch (copyErr: any) {
            // Swallow: a copy failure here usually means maestro itself failed
            // early (bad YAML wrote no *.xml). Throwing SystemError would mask
            // the real reason and cancel billing for a user-side failure — let
            // the lastAttemptExitCode check below surface ERR_MAESTRO_TESTS_FAILED.
            logger.warn(
              `Failed to produce final_report_path at ${junitFinalReportPath}: ${copyErr?.message ?? copyErr}`
            );
          }
        }
      }

      // Upload before the failure verdict so fully-failed runs still get screenshots.
      if (mayHaveJUnitReports) {
        await uploadFailureScreenshotsAsync({
          harvested,
          backend,
          reportDirectories,
          ctx,
          logger,
        });
      }

      // Upload the selected non-JUnit report before the failure verdict. The pre-packaged
      // job also uploads testsDirectory, but a named artifact makes the report easy to find.
      let selectedReport:
        | { name: string; artifactPath: string; finalReportPath: string }
        | undefined;
      switch (outputFormat) {
        case 'html': {
          switch (backend) {
            case 'maestro': {
              if (!maestroCliOutputPath) {
                break;
              }
              selectedReport = {
                name: 'Maestro HTML Report',
                artifactPath: maestroCliOutputPath,
                finalReportPath: maestroCliOutputPath,
              };
              break;
            }
            case 'maestro-runner': {
              const reportDirectory = reportDirectories.at(-1);
              if (!reportDirectory) {
                break;
              }
              // HTML references nearby screenshots, so keep its whole attempt directory.
              selectedReport = {
                name: 'Maestro Runner HTML Report',
                artifactPath: reportDirectory,
                finalReportPath: path.join(reportDirectory, 'report.html'),
              };
              break;
            }
          }
          break;
        }
        case 'allure': {
          switch (backend) {
            case 'maestro':
              logger.warn(
                'Maestro CLI does not support Allure reports; no Allure artifact was uploaded.'
              );
              break;
            case 'maestro-runner': {
              const reportDirectory = reportDirectories.at(-1);
              if (!reportDirectory) {
                break;
              }
              const allureResultsDirectory = path.join(reportDirectory, 'allure-results');
              selectedReport = {
                name: 'Maestro Runner Allure Results',
                artifactPath: allureResultsDirectory,
                finalReportPath: allureResultsDirectory,
              };
              break;
            }
          }
          break;
        }
      }
      if (selectedReport) {
        outputs.final_report_path.set(selectedReport.finalReportPath);
        try {
          await ctx.runtimeApi.uploadArtifact({
            artifact: {
              type: GenericArtifactType.OTHER,
              name: selectedReport.name,
              paths: [selectedReport.artifactPath],
            },
            logger,
          });
        } catch (err: any) {
          logger.warn({ err }, `Failed to upload ${selectedReport.name}.`);
        }
      }

      // The retry loop exits via success (0), numeric status (retryable),
      // or throw (infra). A non-null non-zero status means the user's tests
      // failed every attempt.
      if (lastAttemptExitCode !== 0) {
        throw new UserError(
          'ERR_MAESTRO_TESTS_FAILED',
          `Maestro tests failed after ${totalAttempts} attempt${totalAttempts === 1 ? '' : 's'}.`
        );
      }
    },
  });
}

// Reduce harvested failure screenshots to what's worth uploading, then upload them as workflow
// artifacts. Best-effort and verdict-neutral: never throws, so a screenshot problem can't mask
// the maestro test result. Caller guards on junit (harvest only runs for junit).
async function uploadFailureScreenshotsAsync({
  harvested,
  backend,
  reportDirectories,
  ctx,
  logger,
}: {
  harvested: HarvestedScreenshot[];
  backend: MaestroBackend;
  reportDirectories: string[];
  ctx: CustomBuildContext;
  logger: bunyan;
}): Promise<void> {
  // Reduce to the attempts worth uploading — every failed attempt for flaky flows, only the final
  // attempt for all-failed flows. See computePureFailureFlowNames / selectFailureScreenshots.
  // Guard the JUnit re-parse so a malformed/missing report can't throw past here and mask the
  // test verdict (the whole step is verdict-neutral for screenshots).
  let selected: HarvestedScreenshot[];
  try {
    let flowResults: { name: string; status: 'passed' | 'failed' }[];
    switch (backend) {
      case 'maestro':
        flowResults = (
          await Promise.all(reportDirectories.map(directory => parseJUnitTestCases(directory)))
        ).flat();
        break;
      case 'maestro-runner': {
        const results = await Promise.all(
          reportDirectories.map(directory => parseMaestroRunnerReport(directory))
        );
        // Use whichever reports parsed. An unreadable report (e.g. a final retry that crashed
        // before writing report.json) contributes no flows rather than discarding screenshots
        // harvested from the attempts that did report — mirroring the maestro path above.
        flowResults = results.flatMap(result => result?.flows ?? []);
        break;
      }
    }
    const pureFailureFlowNames = computePureFailureFlowNames(flowResults);
    selected = selectFailureScreenshots(harvested, pureFailureFlowNames);
  } catch (err: any) {
    logger.warn({ err }, 'Failed to classify failure screenshots; skipping screenshot upload.');
    return;
  }
  if (selected.length === 0) {
    return;
  }

  // Cap well under www's 50-artifact-per-job limit.
  const MAX_SCREENSHOT_UPLOADS = 30;
  const toUpload = selected.slice(0, MAX_SCREENSHOT_UPLOADS);
  if (selected.length > toUpload.length) {
    logger.warn(
      `Found ${selected.length} failure screenshots; uploading only the first ${toUpload.length}.`
    );
  }

  // Copy each shot to an ASCII-safe name outside testsDirectory (the originals contain a
  // non-ASCII marker and testsDirectory is uploaded wholesale as the tarball).
  let safeScreenshotDir: string;
  try {
    safeScreenshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-maestro-screenshots-'));
  } catch (err: any) {
    logger.warn(
      { err },
      'Failed to create the failure-screenshot staging dir; skipping screenshot upload.'
    );
    return;
  }

  await Promise.all(
    toUpload.map(async (shot, index) => {
      try {
        // `index` disambiguates two flows that fail within the same millisecond of an attempt.
        const safePath = path.join(
          safeScreenshotDir,
          `failure-attempt-${shot.metadata.attemptIndex}-${index}-${shot.metadata.capturedAtMs}.png`
        );
        await fs.copyFile(shot.fileAbsPath, safePath);
        await ctx.runtimeApi.uploadArtifact({
          artifact: {
            type: GenericArtifactType.OTHER,
            name: shot.displayName,
            paths: [safePath],
            metadata: shot.metadata,
          },
          logger,
        });
      } catch (err: any) {
        logger.warn({ err }, 'Failed to upload failure screenshot.');
      }
    })
  );
}
