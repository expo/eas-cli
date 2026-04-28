import { SystemError, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

import { buildFlowNameToPathMap } from './maestroFlowDiscovery';
import {
  copyLatestAttemptXml,
  mergeJUnitReports,
  parseFailedFlowsFromJUnit,
} from './maestroResultParser';
import { sleepAsync } from '../../utils/retry';

const FlowPathSchema = z.array(z.string().min(1)).min(1);
const RetriesSchema = z.number().int().min(0).default(0);
const ShardsSchema = z.number().int().min(1).optional();

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

// `outputPath: null` means "let maestro pick" (no --output flag). Junit and
// other declared formats pass an explicit path so downstream upload steps
// know where to find the result.
function buildMaestroArgs(args: {
  flow_path: string[];
  outputPath: string | null;
  output_format: string | undefined;
  shards: number | undefined;
  include_tags: string | undefined;
  exclude_tags: string | undefined;
}): string[] {
  const out: string[] = ['test'];
  if (args.output_format) {
    out.push(`--format=${args.output_format.toUpperCase()}`);
  }
  if (args.outputPath) {
    out.push(`--output=${args.outputPath}`);
  }
  if (args.shards !== undefined) {
    out.push(`--shard-split=${args.shards}`);
  }
  if (args.include_tags) {
    out.push(`--include-tags=${args.include_tags}`);
  }
  if (args.exclude_tags) {
    out.push(`--exclude-tags=${args.exclude_tags}`);
  }
  out.push(...args.flow_path);
  return out;
}

export function createMaestroTestsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'maestro_tests',
    name: 'Run Maestro Tests',
    __metricsId: 'eas/maestro_tests',
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
      const finalReportPath =
        outputFormat === 'junit'
          ? path.join(testsDirectory, `${platform}-maestro-junit.xml`)
          : undefined;

      // Public docs (EAS workflows pre-packaged-jobs) document
      // `${MAESTRO_TESTS_DIR}` for users to save screenshots/recordings into
      // the uploaded dir.
      const spawnEnv = { ...env, MAESTRO_TESTS_DIR: testsDirectory };

      // Outputs are published BEFORE any throw below so downstream
      // `if: always()` upload steps still see populated values when this
      // step fails early.
      outputs.tests_directory.set(testsDirectory);
      outputs.junit_report_directory.set(junitReportDirectory);
      if (finalReportPath !== undefined) {
        outputs.final_report_path.set(finalReportPath);
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

      try {
        await fs.mkdir(junitReportDirectory, { recursive: true });
      } catch (err) {
        throw new SystemError('Failed to create JUnit report directory', { cause: err });
      }

      // null → duplicate flow names; smart retry disabled, fall through to
      // dumb retry (re-run everything) on failure.
      const nameToPath = await buildFlowNameToPathMap({
        inputFlowPaths: flowPaths,
        projectRoot: stepCtx.workingDirectory,
        logger,
      });

      // Retry loop. spawn-async error shapes:
      //   ENOENT/EACCES → infra (binary missing/not executable) → SystemError.
      //   numeric err.status → maestro exited non-zero → retry.
      //   else (signal-only, OOM kill, unknown) → infra → SystemError, never
      //     downgraded to "tests failed".
      // Smart retry (junit mode): after a failed attempt, subset to the failing
      // flows. parseFailedFlowsFromJUnit returns null when the JUnit cannot be
      // trusted; we then fall through to dumb retry (re-run everything).
      let flowsToRun: string[] = flowPaths;
      let lastAttemptExitCode: number | null = null;

      const totalAttempts = retries + 1;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const outputPath =
          outputFormat === 'junit'
            ? path.join(junitReportDirectory, `${platform}-maestro-junit-attempt-${attempt}.xml`)
            : outputFormat
              ? path.join(testsDirectory, `${platform}-maestro-${outputFormat}.${outputFormat}`)
              : null;

        const maestroArgs = buildMaestroArgs({
          flow_path: flowsToRun,
          outputPath,
          output_format: outputFormat,
          shards,
          include_tags: includeTags,
          exclude_tags: excludeTags,
        });
        logger.info(
          `Running maestro (attempt ${attempt + 1}/${totalAttempts}): maestro ${maestroArgs.join(' ')}`
        );

        try {
          await spawn('maestro', maestroArgs, {
            cwd: stepCtx.workingDirectory,
            env: spawnEnv,
            logger,
            signal,
          });
          lastAttemptExitCode = 0;
        } catch (err: any) {
          if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
            throw new SystemError('Failed to invoke maestro', { cause: err });
          }
          if (err && typeof err.status === 'number') {
            lastAttemptExitCode = err.status;
          } else {
            throw new SystemError('Unexpected spawn failure invoking maestro', { cause: err });
          }
        }

        if (lastAttemptExitCode === 0 || attempt === retries) {
          break;
        }

        if (outputFormat === 'junit' && outputPath && nameToPath) {
          const failed = await parseFailedFlowsFromJUnit({
            junitFile: outputPath,
            nameToPath,
          });
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

      // Smart merge first; on data errors (bad XML, missing input) fall back
      // to copy-latest so the caller still gets a single JUnit file.
      // Filesystem errors short-circuit straight to SystemError.
      if (finalReportPath !== undefined) {
        try {
          await mergeJUnitReports({
            sourceDir: junitReportDirectory,
            outputPath: finalReportPath,
          });
        } catch (mergeErr: any) {
          if (isFilesystemError(mergeErr)) {
            throw new SystemError('Failed to write final_report_path', { cause: mergeErr });
          }
          logger.warn({ err: mergeErr }, 'Smart merge failed; falling back to copy-latest.');
          try {
            await copyLatestAttemptXml({
              sourceDir: junitReportDirectory,
              outputPath: finalReportPath,
            });
          } catch (copyErr: any) {
            // Swallow: a copy failure here usually means maestro itself failed
            // early (bad YAML wrote no *.xml). Throwing SystemError would mask
            // the real reason and cancel billing for a user-side failure — let
            // the lastAttemptExitCode check below surface ERR_MAESTRO_TESTS_FAILED.
            logger.warn(
              `Failed to produce final_report_path at ${finalReportPath}: ${copyErr?.message ?? copyErr}`
            );
          }
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
