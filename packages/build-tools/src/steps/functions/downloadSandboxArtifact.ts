import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import {
  downloadSandboxArtifactAsync,
  parseSandboxArtifactSource,
} from '../utils/sandboxArtifactDownload';

export function createDownloadSandboxArtifactFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_sandbox_artifact',
    name: 'Download sandbox artifact',
    __metricsId: 'eas/download_sandbox_artifact',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_id',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'agent_run_id',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'name',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_id',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'artifact_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, signal }) => {
      const source = parseSandboxArtifactSource({
        artifactId: inputs.artifact_id.value as string | undefined,
        agentRunId: inputs.agent_run_id.value as string | undefined,
        name: inputs.name.value as string | undefined,
      });

      const { artifactId, artifactPath } = await downloadSandboxArtifactAsync({
        logger: stepsCtx.logger,
        graphqlClient: ctx.graphqlClient,
        ...source,
        signal,
      });

      outputs.artifact_id.set(artifactId);
      outputs.artifact_path.set(artifactPath);
    },
  });
}
