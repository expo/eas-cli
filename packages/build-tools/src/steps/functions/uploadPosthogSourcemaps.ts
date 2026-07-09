import { UserError } from '@expo/eas-build-job';
import { PipeMode } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { PosthogClient, missingPosthogCredentialsMessage } from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

export function createUploadPosthogSourcemapsFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_upload_sourcemaps',
    name: 'Upload source maps to PostHog',
    __metricsId: 'eas/posthog_upload_sourcemaps',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'directory',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'dist',
      }),
      BuildStepInput.createProvider({
        id: 'api_key',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'project_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'ignore_error',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const { logger } = stepCtx;
      const ignoreError = Boolean(inputs.ignore_error.value);

      const result = PosthogClient.fromEnv({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        projectIdOverride: inputs.project_id.value as string | undefined,
        env,
      });
      if (!result.client) {
        PosthogUtils.failOrLogError({
          logger,
          ignoreError,
          error: new UserError(
            'EAS_POSTHOG_MISSING_CREDENTIALS',
            missingPosthogCredentialsMessage(result.missing)
          ),
        });
        return;
      }
      const client = result.client;

      const directory = inputs.directory.value as string;
      const { host, env: cliEnv } = client.cliConfig();
      logger.info(`Uploading source maps from "${directory}" to PostHog`);
      try {
        await spawn(
          'npx',
          ['-y', '@posthog/cli', '--host', host, 'hermes', 'upload', '--directory', directory],
          {
            logger,
            // @posthog/cli writes all its logs, progress and success included, to stderr; tag them as stdout so they don't surface as build errors.
            mode: PipeMode.COMBINED_AS_STDOUT,
            cwd: stepCtx.workingDirectory,
            env: { ...env, ...cliEnv },
          }
        );
      } catch (error) {
        PosthogUtils.failOrLogError({
          logger,
          ignoreError,
          error: new UserError(
            'EAS_POSTHOG_SOURCEMAPS_FAILED',
            'Uploading source maps to PostHog failed.',
            { cause: error }
          ),
        });
        return;
      }

      logger.info('Uploaded source maps to PostHog');
    },
  });
}
