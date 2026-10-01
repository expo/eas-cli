import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { prepareAndroidArtifactAsync } from '../utils/android/appArtifact';

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
    outputProviders: ['artifact_path', 'artifact_type', 'package_name'].map(id =>
      BuildStepOutput.createProvider({ id, required: true })
    ),
    fn: async (ctx, { inputs, outputs }) => {
      const artifact = await prepareAndroidArtifactAsync(
        path.resolve(ctx.workingDirectory, z.string().min(1).parse(inputs.artifact_path.value))
      );
      ctx.logger.info(
        `Android package: ${artifact.packageName}. Artifact type: ${artifact.artifactType}.`
      );
      outputs.artifact_path.set(artifact.artifactPath);
      outputs.artifact_type.set(artifact.artifactType);
      outputs.package_name.set(artifact.packageName);
      // Keep an extracted binary for later steps. The job owns its temporary directory.
    },
  });
}
