import { BuildFunction } from '@expo/steps';

import { setUpNpmrcAsync } from '../../utils/npmrc';

export function createSetUpNpmrcBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'use_npm_token',
    name: 'Use NPM_TOKEN',
    __metricsId: 'eas/use_npm_token',
    fn: async (stepCtx, { env }) => {
      await setUpNpmrcAsync({
        projectTargetDirectory: stepCtx.global.projectTargetDirectory,
        workingDirectory: stepCtx.workingDirectory,
        env,
        logger: stepCtx.logger,
      });
    },
  });
}
