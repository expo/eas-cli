import { BuildFunction, BuildStepOutput } from '@expo/steps';

import { readAndLogPackageJson } from '../../utils/project';

export function createReadPackageJsonBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'read_package_json',
    name: 'Read package.json',
    __metricsId: 'eas/read_package_json',
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'package_json',
        required: false,
      }),
    ],
    fn: async (stepCtx, { outputs }) => {
      try {
        const packageJson = readAndLogPackageJson(stepCtx.logger, stepCtx.workingDirectory);
        outputs.package_json.set(JSON.stringify(packageJson));
      } catch (err: unknown) {
        stepCtx.logger.error({ err });
      }
    },
  });
}
