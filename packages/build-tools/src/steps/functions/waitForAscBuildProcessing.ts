import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { AscApiClient } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';

export function createWaitForAscBuildProcessingBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'wait_for_asc_build_processing',
    name: 'Wait for App Store Connect processing',
    __metricsId: 'eas/wait_for_asc_build_processing',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'asc_api_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_upload_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'apple_app_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_short_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (ctx, { inputs }) => {
      const parsedInputs = z
        .object({
          asc_api_key_path: z.string(),
          build_upload_id: z.string(),
          bundle_identifier: z.string().optional(),
          apple_app_identifier: z.string().optional(),
          bundle_short_version: z.string().optional(),
        })
        .parse({
          asc_api_key_path: inputs.asc_api_key_path.value,
          build_upload_id: inputs.build_upload_id.value,
          bundle_identifier: inputs.bundle_identifier.value,
          apple_app_identifier: inputs.apple_app_identifier.value,
          bundle_short_version: inputs.bundle_short_version.value,
        });
      const keyPath = path.resolve(ctx.workingDirectory, parsedInputs.asc_api_key_path);
      const key = await AscApiUtils.loadApiKeyAsync({ keyPath });
      const client = new AscApiClient({ key, logger: ctx.logger });
      await AscApiUtils.waitForAscBuildProcessingAsync({
        client,
        buildUploadId: parsedInputs.build_upload_id,
        logger: ctx.logger,
        ipaBundleIdentifier: parsedInputs.bundle_identifier,
        appleAppIdentifier: parsedInputs.apple_app_identifier,
        bundleShortVersion: parsedInputs.bundle_short_version,
      });
    },
  });
}
