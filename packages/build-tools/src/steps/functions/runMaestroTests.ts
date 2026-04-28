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

import { copyLatestAttemptXml } from './maestroResultParser';
import { sleepAsync } from '../../utils/retry';

// `outputPath: null` means "let maestro pick" (no --output flag). Junit and
// other declared formats pass an explicit path so downstream upload steps
// know where to find the result.
function buildMaestroArgs(args: {
  flow_paths: string[];
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
  out.push(...args.flow_paths);
  return out;
}

export function createRunMaestroTestsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'run_maestro_tests',
    name: 'Run Maestro Tests',
    __metricsId: 'eas/run_maestro_tests',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'flow_paths',
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
      BuildStepOutput.createProvider({ id: 'final_report_path', required: true }),
      BuildStepOutput.createProvider({ id: 'tests_directory', required: true }),
    ],
    fn: async (stepCtx, { inputs, outputs, env, signal }) => {
      const { logger, global } = stepCtx;
      const platformInput = inputs.platform.value as string | undefined;
      const outputFormat = (inputs.output_format.value as string | undefined)?.toLowerCase();
      const flowPaths = inputs.flow_paths.value as unknown;
      const retries = (inputs.retries.value as number | undefined) ?? 0;
      const shards = inputs.shards.value as number | undefined;
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
        outputFormat === 'junit' ? path.join(testsDirectory, `${platform}-maestro-junit.xml`) : '';

      // Public docs (EAS workflows pre-packaged-jobs) document
      // `${MAESTRO_TESTS_DIR}` for users to save screenshots/recordings into
      // the uploaded dir; the legacy bash step exported it.
      const spawnEnv = { ...env, MAESTRO_TESTS_DIR: testsDirectory };

      // Outputs are published BEFORE any throw below so downstream
      // `if: always()` upload steps still see populated values when this
      // step fails early.
      outputs.tests_directory.set(testsDirectory);
      outputs.junit_report_directory.set(junitReportDirectory);
      outputs.final_report_path.set(finalReportPath);

      if (!Array.isArray(flowPaths) || flowPaths.length === 0) {
        throw new UserError(
          'ERR_MAESTRO_NO_FLOW_PATHS',
          'No flow_paths provided to maestro test step.'
        );
      }
      if (!flowPaths.every(p => typeof p === 'string' && p.length > 0)) {
        throw new UserError(
          'ERR_MAESTRO_INVALID_FLOW_PATHS',
          'All flow_paths entries must be non-empty strings.'
        );
      }
      if (!Number.isInteger(retries) || retries < 0) {
        throw new UserError(
          'ERR_MAESTRO_INVALID_RETRIES',
          'retries must be a non-negative integer.'
        );
      }
      if (shards !== undefined && (!Number.isInteger(shards) || shards < 1)) {
        throw new UserError('ERR_MAESTRO_INVALID_SHARDS', 'shards must be a positive integer.');
      }

      try {
        await fs.mkdir(junitReportDirectory, { recursive: true });
      } catch (err) {
        throw new SystemError('Failed to create JUnit report directory', { cause: err });
      }

      // Wipe stale *.xml from prior runs (cross-platform, since this dir is
      // per-run scratch shared with copyLatestAttemptXml — a leftover
      // `ios-maestro-junit-attempt-3.xml` would otherwise leak into a later
      // Android run). Also drop the previous merged final report so a
      // copy-latest failure doesn't surface last run's output.
      try {
        let existingEntries: string[] = [];
        try {
          existingEntries = await fs.readdir(junitReportDirectory);
        } catch (readErr: any) {
          if (readErr?.code !== 'ENOENT') {
            throw readErr;
          }
        }
        await Promise.all(
          existingEntries
            .filter(e => e.endsWith('.xml'))
            .map(e => fs.unlink(path.join(junitReportDirectory, e)))
        );
        if (finalReportPath) {
          try {
            await fs.unlink(finalReportPath);
          } catch (unlinkErr: any) {
            if (unlinkErr?.code !== 'ENOENT') {
              throw unlinkErr;
            }
          }
        }
      } catch (err) {
        throw new SystemError('Failed to clean stale JUnit report files', { cause: err });
      }

      // Retry loop. spawn-async error shapes:
      //   ENOENT/EACCES → infra (binary missing/not executable) → SystemError.
      //   numeric err.status → maestro exited non-zero → retry.
      //   else (signal-only, OOM kill, unknown) → infra → SystemError, never
      //     downgraded to "tests failed".
      let lastAttemptExitCode: number | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        const outputPath =
          outputFormat === 'junit'
            ? path.join(junitReportDirectory, `${platform}-maestro-junit-attempt-${attempt}.xml`)
            : outputFormat
              ? path.join(testsDirectory, `${platform}-maestro-${outputFormat}.${outputFormat}`)
              : null;

        let attemptSucceeded = false;
        try {
          await spawn(
            'maestro',
            buildMaestroArgs({
              flow_paths: flowPaths,
              outputPath,
              output_format: outputFormat,
              shards,
              include_tags: includeTags,
              exclude_tags: excludeTags,
            }),
            { cwd: stepCtx.workingDirectory, env: spawnEnv, logger, signal }
          );
          lastAttemptExitCode = 0;
          attemptSucceeded = true;
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

        if (attemptSucceeded || attempt === retries) {
          break;
        }

        logger.info('Test failed, retrying...');
        await sleepAsync(2000);
      }

      // Copy the latest attempt's JUnit to the final report path so downstream
      // upload/report steps have a single canonical file.
      if (outputFormat === 'junit') {
        try {
          await copyLatestAttemptXml({
            sourceDir: junitReportDirectory,
            outputPath: finalReportPath,
          });
        } catch (copyErr: any) {
          throw new SystemError('Failed to produce final_report_path', { cause: copyErr });
        }
      }

      // The retry loop exits via success (0), numeric status (retryable),
      // or throw (infra). A non-null non-zero status means the user's tests
      // failed every attempt.
      if (lastAttemptExitCode !== 0) {
        const totalAttempts = retries + 1;
        throw new UserError(
          'ERR_MAESTRO_TESTS_FAILED',
          `Maestro tests failed after ${totalAttempts} attempt${totalAttempts === 1 ? '' : 's'}.`
        );
      }
    },
  });
}
