import { BuildJob, Platform, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { CustomBuildContext } from '../../../customBuildContext';
import {
  BUILD_NUMBER_FORMAT,
  resolveNextBuildNumber,
} from '../../utils/buildNumber/buildNumberRules';
import {
  readStoredBuildNumberAsync,
  storeBuildNumberAsync,
} from '../../utils/buildNumber/storedBuildNumber';

export function createIncrementRemoteBuildNumberBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'increment_remote_build_number',
    name: 'Increment the build number',
    __metricsId: 'eas/increment_remote_build_number',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'application_identifier',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'current_build_number',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'app_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'build_number', required: true })],
    fn: async ({ logger, global }, { inputs, outputs }) => {
      const { appId, platform } = global.staticContext.job as BuildJob;
      const applicationIdentifier = inputs.application_identifier.value as string;
      const currentBuildNumber = inputs.current_build_number.value as string | undefined;
      const key = { appId, platform, applicationIdentifier };

      const { isValid, description } = BUILD_NUMBER_FORMAT[platform];

      const latestStoredBuildNumber = await readStoredBuildNumberAsync(ctx.graphqlClient, key);
      const storedBuildNumber = dropUnusableBuildNumber(latestStoredBuildNumber, {
        source: `the build number that EAS stores for "${applicationIdentifier}"`,
        platform,
        logger,
      });
      if (
        storedBuildNumber === undefined &&
        currentBuildNumber !== undefined &&
        !isValid(currentBuildNumber)
      ) {
        throw new UserError(
          'NATIVE_BUILD_NUMBER_INVALID',
          `EAS cannot assign the next build number. The build number of the project, "${currentBuildNumber}", is not ${description}, and EAS stores no build number for "${applicationIdentifier}" that it can count from. Set the build number of the project to ${description}, for example the number of your latest uploaded build, or set "auto_increment: false" to build with the number of the project.`
        );
      }
      const buildNumber = resolveNextBuildNumber({
        storedBuildNumber,
        projectBuildNumber: dropUnusableBuildNumber(currentBuildNumber, {
          source: 'the build number of the project',
          platform,
          logger,
        }),
      });
      if (!isValid(buildNumber)) {
        throw new UserError(
          'NATIVE_BUILD_NUMBER_INVALID',
          `EAS cannot assign the next build number: ${buildNumber} is not ${description}. Set "auto_increment: false" to build with the number of the project.`
        );
      }
      await storeBuildNumberAsync(ctx.graphqlClient, {
        ...key,
        buildNumber,
        appVersion: (inputs.app_version.value as string | undefined) ?? '1.0.0',
      });

      logger.info(
        `The next build number is ${buildNumber}. Build number of the project: ${
          currentBuildNumber ?? 'none'
        }. Build number that EAS stored for "${applicationIdentifier}" before this build: ${
          latestStoredBuildNumber ?? 'none'
        }. To build with the number of the project, set "auto_increment: false".`
      );
      outputs.build_number.set(buildNumber);
    },
  });
}

function dropUnusableBuildNumber(
  buildNumber: string | undefined,
  { source, platform, logger }: { source: string; platform: Platform; logger: bunyan }
): string | undefined {
  const { isValid, description } = BUILD_NUMBER_FORMAT[platform];
  if (buildNumber === undefined || isValid(buildNumber)) {
    return buildNumber;
  }
  logger.warn(
    `EAS does not count from ${source}, "${buildNumber}", because it is not ${description}.`
  );
  return undefined;
}
