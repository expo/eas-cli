import { BuildFunction } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { waitForPrecompiledModulesPreparationAsync } from '../../utils/precompiledModules';

export function createInstallPodsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_pods',
    name: 'Install Pods',
    __metricsId: 'eas/install_pods',
    fn: async (stepsCtx, { env }) => {
      try {
        await waitForPrecompiledModulesPreparationAsync();
      } catch (err) {
        stepsCtx.logger.warn(
          { err },
          'Precompiled dependencies were not prepared successfully, continuing with pod install'
        );
      }
      stepsCtx.logger.info('Installing pods');
      const verboseFlag = stepsCtx.global.env['EAS_VERBOSE'] === '1' ? ['--verbose'] : [];
      const cocoapodsDeploymentFlag =
        stepsCtx.global.env['POD_INSTALL_DEPLOYMENT'] === '1' ? ['--deployment'] : [];

      await spawn('pod', ['install', ...verboseFlag, ...cocoapodsDeploymentFlag], {
        logger: stepsCtx.logger,
        env: {
          ...env,
          LANG: 'en_US.UTF-8',
        },
        cwd: stepsCtx.workingDirectory,
        lineTransformer: (line?: string) => {
          if (
            !line ||
            /\[!\] '[\w-]+' uses the unencrypted 'http' protocol to transfer the Pod\./.exec(line)
          ) {
            return null;
          } else {
            return line;
          }
        },
      });
    },
  });
}
