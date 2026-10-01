import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  prepareAndroidArtifactAsync,
  readAndroidPackageNameAsync,
} from '../utils/android/appArtifact';

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
      try {
        const packageName = await readAndroidPackageNameAsync(
          artifact.artifactPath,
          artifact.artifactType,
          AbortSignal.timeout(60_000)
        );
        ctx.logger.info(
          `Android package: ${packageName}. Artifact type: ${artifact.artifactType}.`
        );
        outputs.artifact_path.set(artifact.artifactPath);
        outputs.artifact_type.set(artifact.artifactType);
        outputs.package_name.set(packageName);
        // Keep an extracted binary for later steps. The job owns its temporary directory.
      } catch (error) {
        if (artifact.extractionDirectory) {
          await fs
            .rm(artifact.extractionDirectory, { recursive: true, force: true })
            .catch(() => {});
        }
        throw error;
      }
    },
  });
}
