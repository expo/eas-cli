import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { CredentialsContext } from '../../credentials/context';
import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { getAppFromContextAsync } from '../../credentials/ios/actions/BuildCredentialsUtils';
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
    app: await getAppFromContextAsync(buildCtx.credentialsCtx),
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

export async function ensureIosCredentialsForBuildResignAsync(
  credentialsCtx: CredentialsContext,
  targets: Target[],
  buildProfile: BuildProfile<Platform.IOS>
): Promise<CredentialsResult<IosCredentials>> {
  const provider = new IosCredentialsProvider(credentialsCtx, {
    app: await getAppFromContextAsync(credentialsCtx),
    targets,
    distribution: 'internal',
    enterpriseProvisioning: buildProfile.enterpriseProvisioning,
  });

  const { credentialsSource } = buildProfile;

  logCredentialsSource(credentialsSource, Platform.IOS);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(buildCtx: BuildContext<Platform.IOS>): boolean {
  return !buildCtx.buildProfile.simulator && !buildCtx.buildProfile.withoutCredentials;
}
