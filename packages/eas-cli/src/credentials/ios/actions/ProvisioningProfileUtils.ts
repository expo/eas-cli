import chalk from 'chalk';

import log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Context } from '../../context';
import {
  DistributionCertificate,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
} from '../appstore/Credentials.types';
import { IosAppCredentials } from '../credentials';

export async function selectProvisioningProfileFromAppleAsync(
  ctx: Context,
  bundleIdentifier: string
): Promise<ProvisioningProfileStoreInfo | null> {
  const profiles = await ctx.appStore.listProvisioningProfilesAsync(bundleIdentifier);
  if (profiles.length === 0) {
    log.warn(
      `There are no Provisioning Profiles available on Apple Developer Portal for bundle identifier ${bundleIdentifier}.`
    );
    return null;
  }

  const { credentialsIndex } = await promptAsync({
    type: 'select',
    name: 'credentialsIndex',
    message: 'Select Provisioning Profile from the list.',
    choices: profiles.map((entry, index) => ({
      title: formatProvisioningProfileFromApple(entry),
      value: index,
    })),
  });
  return profiles[credentialsIndex];
}

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

export async function selectProvisioningProfileFromExpoAsync(
  ctx: Context,
  accountName: string
): Promise<IosAppCredentials | null> {
  const profiles = (await ctx.ios.getAllCredentialsAsync(accountName)).appCredentials.filter(
    ({ credentials }) => !!credentials.provisioningProfile && !!credentials.provisioningProfileId
  );
  if (profiles.length === 0) {
    log.warn('There are no Provisioning Profiles available in your EAS account.');
    return null;
  }

  const format = (profile: IosAppCredentials) => {
    const id = chalk.green(profile.credentials.provisioningProfileId || '-----');
    const teamId = profile.credentials.teamId || '------';
    return `Provisioning Profile (ID: ${id}, Team ID: ${teamId})`;
  };

  const { credentialsIndex } = await promptAsync({
    type: 'select',
    name: 'credentialsIndex',
    message: 'Select Provisioning Profile from the list.',
    choices: profiles.map((entry, index) => ({
      title: format(entry),
      value: index,
    })),
  });
  return profiles[credentialsIndex];
}

export async function generateProvisioningProfileAsync(
  ctx: Context,
  bundleIdentifier: string,
  distCert: DistributionCertificate
): Promise<ProvisioningProfile> {
  const appleAuthCtx = await ctx.appStore.ensureAuthenticatedAsync();
  const type = appleAuthCtx.team.inHouse ? 'Enterprise ' : 'AppStore';
  const profileName = `*[expo] ${bundleIdentifier} ${type} ${new Date().toISOString()}`; // Apple drops [ if its the first char (!!)
  return await ctx.appStore.createProvisioningProfileAsync(bundleIdentifier, distCert, profileName);
}
