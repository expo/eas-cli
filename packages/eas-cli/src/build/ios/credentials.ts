import { Platform } from '@expo/eas-build-job';

import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider.js';
import { getAppFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils.js';
import { IosCredentials, Target } from '../../credentials/ios/types.js';
import { CredentialsResult } from '../build.js';
import { BuildContext } from '../context.js';
import { logCredentialsSource } from '../utils/credentials.js';

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
