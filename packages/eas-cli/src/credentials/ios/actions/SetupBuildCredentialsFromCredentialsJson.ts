import chalk from 'chalk';
import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Context } from '../../context';
import {
  IosTargetCredentials,
  isCredentialsMap,
  readIosCredentialsAsync,
} from '../../credentialsJson/read';
import { AppLookupParams } from '../api/GraphqlClient';
import { displayProjectCredentials } from '../utils/printCredentials';
import { readAppleTeam } from '../utils/provisioningProfile';
import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getDistributionCertificateAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';

export class SetupBuildCredentialsFromCredentialsJson {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  async getDistributionCertificateToAssignAsync(
    ctx: Context,
    targetCredentials: IosTargetCredentials,
    appleTeam: AppleTeamFragment,
    currentDistributionCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    const { distributionCertificate } = targetCredentials;
    const { certP12, certPassword } = distributionCertificate;

    if (!currentDistributionCertificate) {
      return await ctx.ios.createDistributionCertificateAsync(this.app.account, {
        certP12,
        certPassword,
        teamId: appleTeam.appleTeamIdentifier,
        teamName: appleTeam.appleTeamName ?? undefined,
      });
    }

    const isSameCertificate = currentDistributionCertificate.certificateP12 === certP12;
    if (!isSameCertificate) {
      return await ctx.ios.createDistributionCertificateAsync(this.app.account, {
        certP12,
        certPassword,
        teamId: appleTeam.appleTeamIdentifier,
        teamName: appleTeam.appleTeamName ?? undefined,
      });
    }

    // If the configured Distribution Certificate is the same as the new one, just use the currently configured certificate
    return currentDistributionCertificate;
  }

  async createNewProvisioningProfileAsync(
    ctx: Context,
    targetCredentials: IosTargetCredentials,
    appleTeam: AppleTeamFragment
  ): Promise<AppleProvisioningProfileFragment> {
    const { provisioningProfile } = targetCredentials;

    const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    return await ctx.ios.createProvisioningProfileAsync(this.app, appleAppIdentifier, {
      appleProvisioningProfile: provisioningProfile,
    });
  }

  async getProvisioningProfileToAssignAsync(
    ctx: Context,
    targetCredentials: IosTargetCredentials,
    appleTeam: AppleTeamFragment,
    currentProvisioningProfile: AppleProvisioningProfileFragment | null
  ): Promise<AppleProvisioningProfileFragment> {
    const { provisioningProfile } = targetCredentials;

    if (!currentProvisioningProfile) {
      return await this.createNewProvisioningProfileAsync(ctx, targetCredentials, appleTeam);
    }

    const isSameProfile = currentProvisioningProfile.provisioningProfile === provisioningProfile;
    if (!isSameProfile) {
      return await this.createNewProvisioningProfileAsync(ctx, targetCredentials, appleTeam);
    }

    // If the configured Provisioning Profile is the same as the new one, just use the currently configured profile
    return currentProvisioningProfile;
  }

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    let localCredentials;
    try {
      localCredentials = await readIosCredentialsAsync(ctx.projectDir);
    } catch (error) {
      Log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }

    // TODO: implement storing multi-target credentials on EAS servers
    if (isCredentialsMap(localCredentials)) {
      throw new Error(
        'Storing multi-target iOS credentials from credentials.json on EAS servers is not yet supported.'
      );
    }

    // currently configured credentials
    const buildCredentials = await getBuildCredentialsAsync(ctx, this.app, this.distributionType);
    const currentDistributionCertificate = await getDistributionCertificateAsync(
      ctx,
      this.app,
      this.distributionType
    );
    const currentProfile = await getProvisioningProfileAsync(ctx, this.app, this.distributionType);
    const appInfo = `@${this.app.account.name}/${this.app.projectName} (${this.app.bundleIdentifier})`;

    // new credentials from local json
    const appleTeamFromProvisioningProfile = readAppleTeam(localCredentials.provisioningProfile);
    const appleTeam = await ctx.ios.createOrGetExistingAppleTeamAsync(this.app.account, {
      appleTeamIdentifier: appleTeamFromProvisioningProfile.teamId,
      appleTeamName: appleTeamFromProvisioningProfile.teamName,
    });
    const distributionCertificateToAssign = await this.getDistributionCertificateToAssignAsync(
      ctx,
      localCredentials,
      appleTeam,
      currentDistributionCertificate
    );
    const provisioningProfileToAssign = await this.getProvisioningProfileToAssignAsync(
      ctx,
      localCredentials,
      appleTeam,
      currentProfile
    );

    const didCredentialsChange =
      !currentDistributionCertificate ||
      !currentProfile ||
      currentDistributionCertificate.id !== distributionCertificateToAssign.id ||
      currentProfile.id !== provisioningProfileToAssign.id;
    if (!didCredentialsChange) {
      Log.log('Credentials have already been configured to your credentials json.');
      return nullthrows(buildCredentials, 'buildCredentials should have been defined.');
    }

    if (buildCredentials) {
      Log.log('Currently configured credentials:');
      displayProjectCredentials(this.app, buildCredentials);
      if (!ctx.nonInteractive) {
        const confirm = await confirmAsync({
          message: `Would you like to replace this configuration with credentials from credentials json?`,
        });
        if (!confirm) {
          throw new Error('Aborting setup of build credentials from credentials json');
        }
      }
    }

    Log.log(`Assigning credentials from credentials json to ${appInfo}...`);
    const newBuildCredentials = await assignBuildCredentialsAsync(
      ctx,
      this.app,
      this.distributionType,
      distributionCertificateToAssign,
      provisioningProfileToAssign,
      appleTeam
    );

    Log.log('New credentials configuration:');
    displayProjectCredentials(this.app, newBuildCredentials);

    Log.newLine();
    Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
    Log.newLine();
    return newBuildCredentials;
  }
}
