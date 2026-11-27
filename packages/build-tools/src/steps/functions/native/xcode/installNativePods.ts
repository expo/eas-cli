import { BuildFunction } from '@expo/steps';
import fs from 'node:fs';
import path from 'node:path';

import { runPodInstallAsync } from '../../installPods';

export function createInstallNativePodsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_native_pods',
    name: 'Install Pods',
    __metricsId: 'eas/install_native_pods',
    fn: async (stepsCtx, { env }) => {
      if (!fs.existsSync(path.join(stepsCtx.workingDirectory, 'Podfile'))) {
        stepsCtx.logger.info('The project directory has no Podfile. Skipping "pod install".');
        return;
      }
      await runPodInstallAsync(stepsCtx, env);
    },
  });
}
