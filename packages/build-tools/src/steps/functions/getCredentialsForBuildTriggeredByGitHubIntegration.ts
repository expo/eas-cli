import { BuildJob } from '@expo/eas-build-job';
import { BuildFunction } from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';

import { resolveBuildConfigAsync } from './resolveBuildConfig';

export function createGetCredentialsForBuildTriggeredByGithubIntegration(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'get_credentials_for_build_triggered_by_github_integration',
    name: 'Get credentials for build triggered by GitHub integration',
    __metricsId: 'eas/get_credentials_for_build_triggered_by_github_integration',
    fn: async (stepCtx, { env }) => {
      await resolveBuildConfigAsync({
        logger: stepCtx.logger,
        env,
        workingDirectory: stepCtx.workingDirectory,
        ctx,
      });
    },
  });
}
