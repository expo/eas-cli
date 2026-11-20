import { Ios } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { z } from 'zod';

import { CustomBuildContext } from '../../../customBuildContext';
import { InstalledIosCredentials } from '../../utils/ios/credentials/installedCredentials';
import IosCredentialsManager from '../../utils/ios/credentials/manager';
import { resolveStoredIosBuildCredentialsAsync } from '../../utils/ios/credentials/storedCredentials';

export function createPrepareIosCredentialsBuildFunction(
  ctx: CustomBuildContext<Ios.Job>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'prepare_ios_credentials',
    name: 'Prepare iOS credentials',
    __metricsId: 'eas/prepare_ios_credentials',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'targets',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'distribution',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        allowedValues: ['store', 'internal'],
      }),
      BuildStepInput.createProvider({
        id: 'enterprise_provisioning',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        allowedValues: ['adhoc', 'universal'],
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({ id: 'installed_credentials', required: true }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const { appId } = stepsCtx.global.staticContext.job as Ios.Job;
      const targets = z
        .array(z.object({ name: z.string(), bundleIdentifier: z.string() }))
        .parse(inputs.targets.value);

      const buildCredentials = await resolveStoredIosBuildCredentialsAsync(ctx.graphqlClient, {
        appId,
        targets,
        distribution: inputs.distribution.value as NonNullable<Ios.Job['distribution']>,
        enterpriseProvisioning: inputs.enterprise_provisioning
          .value as Ios.Job['enterpriseProvisioning'],
      });
      const { keychainPath, distributionType, targetProvisioningProfiles } =
        await new IosCredentialsManager(buildCredentials).prepare(stepsCtx.logger);

      const installedCredentials: InstalledIosCredentials = {
        keychainPath,
        distributionType,
        profileByTargetName: Object.fromEntries(
          targets.map(({ name: targetName, bundleIdentifier }) => {
            const { name, uuid, teamId, certificateCommonName } =
              targetProvisioningProfiles[targetName];
            return [
              targetName,
              {
                bundleIdentifier,
                profileName: name,
                profileUuid: uuid,
                teamId,
                certificateCommonName,
              },
            ];
          })
        ),
      };
      outputs.installed_credentials.set(JSON.stringify(installedCredentials));
    },
  });
}
