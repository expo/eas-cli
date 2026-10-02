import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { z } from 'zod';

import { downloadBuildAsync } from './downloadBuild';
import { CustomBuildContext } from '../../customBuildContext';

export function createDownloadAppArchiveFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_app_archive',
    name: 'Download app archive',
    __metricsId: 'eas/download_app_archive',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'application_archive_url',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'extensions',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: ['apk', 'aab', 'ipa', 'app'],
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'artifact_path', required: true })],
    fn: async (stepsCtx, { inputs, outputs, signal }) => {
      const applicationArchiveUrl = z.string().parse(inputs.application_archive_url.value);
      const extensions = z.array(z.string()).parse(inputs.extensions.value);
      stepsCtx.logger.info(
        `Downloading app archive. Expected extensions: [${extensions.join(', ')}]`
      );
      const { artifactPath } = await downloadBuildAsync({
        logger: stepsCtx.logger,
        graphqlClient: ctx.graphqlClient,
        applicationArchiveUrl,
        robotAccessToken: null,
        extensions,
        signal,
      });
      outputs.artifact_path.set(artifactPath);
    },
  });
}
