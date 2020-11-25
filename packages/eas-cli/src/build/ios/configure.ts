import { CredentialsSource, DistributionType, Workflow } from '@expo/eas-json';
import { ExpoConfig, IOSConfig } from '@expo/config';

import * as ProvisioningProfileUtils from '../../credentials/ios/utils/provisioningProfile';
import log from '../../log';
import { getProjectAccountNameAsync } from '../../project/projectUtils';
import { confirmAsync } from '../../prompts';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import { getBundleIdentifier } from './bundleIdentifer';
import { resolveIosCredentialsAsync } from './credentials';

export async function configureIosAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasIosNativeProject) {
    return;
  }
  const bundleIdentifier = await getBundleIdentifier(ctx.projectDir, ctx.exp);
  IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(ctx.projectDir, bundleIdentifier, false);

  const confirm = await confirmAsync({
    message: 'Do you want to configure credentials for the Xcode project?',
  });
  if (confirm) {
    await resolveCredentialsAndConfigureXcodeProjectAsync(ctx, bundleIdentifier);
  }

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Configured the Xcode project.');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  // TODO: check bundle identifier
  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}

async function resolveCredentialsAndConfigureXcodeProjectAsync(
  ctx: ConfigureContext,
  bundleIdentifier: string
): Promise<void> {
  const { credentials } = await resolveIosCredentialsAsync(ctx.projectDir, {
    app: {
      accountName: await getProjectAccountNameAsync(ctx.projectDir),
      projectName: ctx.exp.slug,
      bundleIdentifier,
    },
    workflow: Workflow.Generic,
    credentialsSource: CredentialsSource.AUTO,
    distribution: DistributionType.STORE,
    nonInteractive: false,
  });

  const profileName = ProvisioningProfileUtils.readProfileName(credentials.provisioningProfile);
  const appleTeam = ProvisioningProfileUtils.readAppleTeam(credentials.provisioningProfile);
  IOSConfig.ProvisioningProfile.setProvisioningProfileForPbxproj(ctx.projectDir, {
    profileName,
    appleTeamId: appleTeam.teamId,
  });
  // TODO: copy profile and add dist cert to keychain
}
