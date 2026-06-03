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

  const { credentialsSource } = buildCtx.buildProfile;
  if (
    buildCtx.credentialsCtx.refreshAdHocProvisioningProfile &&
    credentialsSource === 'local'
  ) {
    throw new Error(
      '--refresh-ad-hoc-provisioning-profile cannot be used with credentialsSource "local". Use remote credentials or omit the flag.'
    );
  }
  if (buildCtx.credentialsCtx.refreshDistributionCertificate && credentialsSource === 'local') {
    throw new Error(
      '--refresh-distribution-certificate cannot be used with credentialsSource "local". Use remote credentials or omit the flag.'
    );
  }

  const provider = new IosCredentialsProvider(buildCtx.credentialsCtx, {
    app: await getAppFromContextAsync(buildCtx.credentialsCtx),
    targets,
    distribution: buildCtx.buildProfile.distribution ?? 'store',
    enterpriseProvisioning: buildCtx.buildProfile.enterpriseProvisioning,
  });

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
