import { Platform as ApplePlatform } from '@expo/apple-utils';
import chalk from 'chalk';

import { getApplePlatformFromSdkRoot } from '../../../project/ios/target';
import { TargetCredentialsContext } from '../../context';
import {
  DistributionCertificate,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
} from '../appstore/Credentials.types';

export function formatProvisioningProfileFromApple(
  appleInfo: ProvisioningProfileStoreInfo
): string {
  const { expires, provisioningProfileId } = appleInfo;
  const id = provisioningProfileId ?? '-----';
  const name = appleInfo.name ?? '-----';
  const expiryString = expires ? new Date(expires * 1000).toDateString() : 'unknown';
  const details = chalk.green(`\n    Name: ${name}\n    Expiry: ${expiryString}`);
  return `Provisioning Profile - ID: ${id}${details}`;
}

export async function generateProvisioningProfileAsync(
  ctx: TargetCredentialsContext,
  bundleIdentifier: string,
  distCert: DistributionCertificate
): Promise<ProvisioningProfile> {
  const appleAuthCtx = await ctx.appStore.ensureAuthenticatedAsync();
  const type = appleAuthCtx.team.inHouse ? 'Enterprise ' : 'AppStore';
  const profileName = `*[expo] ${bundleIdentifier} ${type} ${new Date().toISOString()}`; // Apple drops [ if its the first char (!!)
  const applePlatform = (await getApplePlatformFromSdkRoot(ctx.target)) ?? ApplePlatform.IOS;
  return await ctx.appStore.createProvisioningProfileAsync(
    bundleIdentifier,
    distCert,
    profileName,
    applePlatform
  );
}
