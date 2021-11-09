import { Platform } from '@expo/eas-build-job';

import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { getAppFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils';
import { resolveEntitlementsJsonAsync } from '../../credentials/ios/appstore/entitlements';
import { IosCredentials, Target } from '../../credentials/ios/types';
import { CredentialsResult } from '../build';
import { BuildContext } from '../context';
import { logCredentialsSource } from '../utils/credentials';

export async function ensureIosCredentialsAsync(
  buildCtx: BuildContext<Platform.IOS>,
  targets: Target[]
): Promise<CredentialsResult<IosCredentials> | undefined> {
  if (!shouldProvideCredentials(buildCtx)) {
    return;
  }

  const provider = new IosCredentialsProvider(buildCtx.credentialsCtx, {
    app: getAppFromContext(buildCtx.credentialsCtx),
    targets,
    iosCapabilitiesOptions: {
      entitlements: await resolveEntitlementsJsonAsync(
        buildCtx.projectDir,
        buildCtx.workflow,
        buildCtx.buildProfile.env ?? {}
      ),
    },
    distribution: buildCtx.buildProfile.distribution ?? 'store',
    enterpriseProvisioning: buildCtx.buildProfile.enterpriseProvisioning,
  });

  const { credentialsSource } = buildCtx.buildProfile;

  logCredentialsSource(credentialsSource, Platform.IOS);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(buildCtx: BuildContext<Platform.IOS>): boolean {
  return !buildCtx.buildProfile.simulator;
}
