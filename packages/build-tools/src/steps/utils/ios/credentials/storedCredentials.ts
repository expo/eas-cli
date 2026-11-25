import { Ios } from '@expo/eas-build-job';
import { Client } from '@urql/core';

import {
  readStoredIosAppCredentialsAsync,
  readStoredIosBuildCredentialsAsync,
} from './storedCredentialsQueries';
import {
  IosSigningRequest,
  IosSigningTarget,
  selectStoredIosBuildCredentials,
  validateStoredIosBuildCredentials,
} from './storedCredentialsRules';

export async function resolveStoredIosBuildCredentialsAsync(
  graphqlClient: Client,
  { appId, targets, ...request }: { appId: string; targets: IosSigningTarget[] } & IosSigningRequest
): Promise<Ios.BuildCredentials> {
  const { iosDistributionType, targets: selectedTargets } = selectStoredIosBuildCredentials(
    targets,
    await readStoredIosAppCredentialsAsync(graphqlClient, { appId }),
    request
  );
  return validateStoredIosBuildCredentials(
    await Promise.all(
      selectedTargets.map(async ({ target, appleAppIdentifierId }) => ({
        target,
        buildCredentials: await readStoredIosBuildCredentialsAsync(graphqlClient, {
          appId,
          appleAppIdentifierId,
          iosDistributionType,
        }),
      }))
    ),
    { iosDistributionType, request, now: new Date() }
  );
}
