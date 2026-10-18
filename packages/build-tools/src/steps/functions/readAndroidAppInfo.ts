import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { readAndroidArtifactInfoAsync } from '../utils/android/appArtifact';

export function createReadAndroidAppInfoBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'read_android_app_info',
    name: 'Read Android app info',
    __metricsId: 'eas/read_android_app_info',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({ id: 'artifact_type', required: true }),
      BuildStepOutput.createProvider({ id: 'package_name', required: true }),
    ],
    fn: async (ctx, { inputs, outputs, signal }) => {
      const artifactPath = path.resolve(
        ctx.workingDirectory,
        z.string().min(1).parse(inputs.artifact_path.value)
      );
      ctx.logger.info(`Reading Android artifact: ${artifactPath}.`);
      const artifact = await readAndroidArtifactInfoAsync(artifactPath, signal);
      ctx.logger.info(`Android artifact type: ${artifact.artifactType}.`);
      ctx.logger.info(`Android package name: ${artifact.packageName}.`);
      outputs.artifact_type.set(artifact.artifactType);
      outputs.package_name.set(artifact.packageName);
    },
  });
}
