import { BuildFunction } from '@expo/steps';
import fs from 'fs-extra';

export function createCheckoutBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'checkout',
    name: 'Checkout',
    __metricsId: 'eas/checkout',
    fn: async (stepsCtx) => {
      if (stepsCtx.global.wasCheckedOut()) {
        stepsCtx.logger.info('Project directory is already checked out');
        return;
      }
      stepsCtx.logger.info('Checking out project directory');
      await fs.move(
        stepsCtx.global.projectSourceDirectory,
        stepsCtx.global.projectTargetDirectory,
        {
          overwrite: true,
        }
      );
      stepsCtx.global.markAsCheckedOut(stepsCtx.logger);
    },
  });
}
