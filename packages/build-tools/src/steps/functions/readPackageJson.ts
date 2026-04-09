import { BuildFunction } from '@expo/steps';

import { readPackageJson } from '../../utils/project';

export function createReadPackageJsonBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'read_package_json',
    name: 'Read package.json',
    __metricsId: 'eas/read_package_json',
    fn: async stepCtx => {
      stepCtx.logger.info('Using package.json:');
      const packageJson = readPackageJson(stepCtx.workingDirectory);
      stepCtx.logger.info(JSON.stringify(packageJson, null, 2));
    },
  });
}
