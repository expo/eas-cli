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
      const keyPath = path.resolve(
        ctx.workingDirectory,
        z.string().parse(inputs.asc_api_key_path.value)
      );
      const buildUploadId = z.string().parse(inputs.build_upload_id.value);
      const ipaBundleIdentifier = z.string().optional().parse(inputs.bundle_identifier.value);
      const appleAppIdentifier = z.string().optional().parse(inputs.apple_app_identifier.value);
      const bundleShortVersion = z.string().optional().parse(inputs.bundle_short_version.value);
      const key = await AscApiUtils.loadApiKeyAsync({ keyPath });
      const client = new AscApiClient({ key, logger: ctx.logger });
      await AscApiUtils.waitForAscBuildProcessingAsync({
        client,
        buildUploadId,
        logger: ctx.logger,
        ipaBundleIdentifier,
        appleAppIdentifier,
        bundleShortVersion,
      });
    },
  });
}
