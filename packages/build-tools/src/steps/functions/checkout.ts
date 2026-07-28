import { ArchiveSourceType, UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import fs from 'fs-extra';
import { z } from 'zod';

import { fetchAndCheckoutRefAsync } from '../../common/git';

export function createCheckoutBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'checkout',
    name: 'Checkout',
    __metricsId: 'eas/checkout',
    __hookId: 'checkout',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'ref',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepsCtx, { inputs }) => {
      const ref = z.string().min(1).optional().parse(inputs.ref.value);

      if (stepsCtx.global.wasCheckedOut()) {
        if (ref) {
          throw new UserError(
            'EAS_CHECKOUT_REF_AFTER_CHECKOUT',
            `Project directory is already checked out, so the "ref" input (${ref}) would have no effect. Move this eas/checkout step before any other step that checks out the project (e.g. before eas/build).`
          );
        }
        stepsCtx.logger.info('Project directory is already checked out');
        return;
      }

      const archiveType = stepsCtx.global.staticContext.job.projectArchive.type;
      if (ref && archiveType !== ArchiveSourceType.GIT) {
        throw new UserError(
          'EAS_CHECKOUT_REF_REQUIRES_GIT_SOURCES',
          `The "ref" input requires project sources to come from a git repository, e.g. a job triggered through the GitHub integration. It is not supported for local builds or uploaded project tarballs (this job's project archive type is "${archiveType}").`
        );
      }

      stepsCtx.logger.info('Checking out project directory');
      await fs.move(
        stepsCtx.global.projectSourceDirectory,
        stepsCtx.global.projectTargetDirectory,
        {
          overwrite: true,
        }
      );

      if (ref) {
        stepsCtx.logger.info(`Checking out ref "${ref}"`);
        await fetchAndCheckoutRefAsync({
          ref,
          repositoryDirectory: stepsCtx.global.projectTargetDirectory,
        });
      }

      stepsCtx.global.markAsCheckedOut(stepsCtx.logger);
    },
  });
}
