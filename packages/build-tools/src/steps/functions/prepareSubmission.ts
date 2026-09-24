import { Platform, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import { SubmissionCredentials } from '../utils/submission/credentials';
import { prepareSubmissionAsync } from '../utils/submission/prepareSubmission';
import { ensureSubmissionTestFlightSetupAsync } from '../utils/submission/testFlightSetup';

export function createPrepareSubmissionFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'prepare_submission',
    name: 'Prepare submission',
    __metricsId: 'eas/prepare_submission',
    inputProviders: [
      ...['build_id', 'platform', 'application_identifier'].map(id =>
        BuildStepInput.createProvider({
          id,
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        })
      ),
      BuildStepInput.createProvider({
        id: 'profile',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'groups',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    outputProviders: [
      'credentials_directory',
      'asc_app_identifier',
      'json_key_path',
      'apple_id_username',
      'apple_app_specific_password_path',
      'google_service_account_key_path',
      'groups',
      'track',
      'release_status',
      'rollout',
      'changes_not_sent_for_review',
      'is_verbose_fastlane_enabled',
    ].map(id => BuildStepOutput.createProvider({ id, required: false })),
    fn: async (stepCtx, { inputs, outputs, env }) => {
      const platform = z.enum([Platform.IOS, Platform.ANDROID]).parse(inputs.platform.value);
      const appId = z.string().uuid().parse(stepCtx.global.staticContext.job.appId);
      const parentDirectory = path.join(stepCtx.global.stepsInternalBuildDirectory, 'submissions');
      await fs.ensureDir(parentDirectory, { mode: 0o700 });
      const credentialsDirectory = await fs.mkdtemp(path.join(parentDirectory, 'credentials-'));
      outputs.credentials_directory.set(credentialsDirectory);
      try {
        const prepared = await prepareSubmissionAsync({
          platform,
          buildId: z.string().uuid().parse(inputs.build_id.value),
          profileName: z.string().optional().parse(inputs.profile.value),
          applicationIdentifier: z.string().min(1).parse(inputs.application_identifier.value),
          groups: z.array(z.string()).optional().parse(inputs.groups.value),
          workingDirectory: stepCtx.workingDirectory,
          credentialsDirectory,
          credentials: new SubmissionCredentials(ctx.graphqlClient, appId),
          env,
          logger: stepCtx.logger,
          ensureTestFlightSetupAsync: async (key, ascAppId) => {
            await ensureSubmissionTestFlightSetupAsync(key, ascAppId, stepCtx.logger);
          },
        });
        for (const [key, value] of Object.entries(prepared)) {
          outputs[key].set(value);
        }
      } catch (error) {
        await fs.remove(credentialsDirectory);
        throw error;
      }
    },
  });
}

export function createCleanupSubmissionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'cleanup_submission',
    name: 'Remove submission credentials',
    __metricsId: 'eas/cleanup_submission',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'credentials_directory',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      const directory = z.string().optional().parse(inputs.credentials_directory.value);
      if (!directory) {
        return;
      }
      const expectedParent = path.resolve(
        stepCtx.global.stepsInternalBuildDirectory,
        'submissions'
      );
      if (
        path.dirname(path.resolve(directory)) !== expectedParent ||
        !path.basename(directory).startsWith('credentials-')
      ) {
        throw new UserError(
          'EAS_SUBMISSION_INVALID_CLEANUP_PATH',
          'The credential directory was not created by prepare_submission in this job. Pass its credentials_directory output.'
        );
      }
      await fs.remove(directory);
    },
  });
}
