import chalk from 'chalk';
import nullthrows from 'nullthrows';

import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getDistributionCertificateAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';
import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { IosTargetCredentials } from '../../credentialsJson/types';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { displayProjectCredentials } from '../utils/printCredentials';
import { readAppleTeam } from '../utils/provisioningProfile';

export class SetUpTargetBuildCredentialsFromCredentialsJson {
  constructor(
    private readonly app: AppLookupParams,
    private readonly distributionType: IosDistributionType,
    private readonly targetCredentials: IosTargetCredentials
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
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
    const appleTeamFromProvisioningProfile = readAppleTeam(
      this.targetCredentials.provisioningProfile
    );
    const appleTeam = await ctx.ios.createOrGetExistingAppleTeamAsync(
      ctx.graphqlClient,
      this.app.account,
      {
        appleTeamIdentifier: appleTeamFromProvisioningProfile.teamId,
        appleTeamName: appleTeamFromProvisioningProfile.teamName,
      }
    );
    const distributionCertificateToAssign = await this.getDistributionCertificateToAssignAsync(
      ctx,
      appleTeam,
      currentDistributionCertificate
    );
    const provisioningProfileToAssign = await this.getProvisioningProfileToAssignAsync(
      ctx,
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
      displaySingleTargetProjectCredentials(this.app, buildCredentials);
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
    displaySingleTargetProjectCredentials(this.app, newBuildCredentials);

    Log.newLine();
    Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
    Log.newLine();
    return newBuildCredentials;
  }

  async getDistributionCertificateToAssignAsync(
    ctx: CredentialsContext,
    appleTeam: AppleTeamFragment,
    currentDistributionCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    const { certificateP12, certificatePassword } = this.targetCredentials.distributionCertificate;

    if (!currentDistributionCertificate) {
      return await ctx.ios.createDistributionCertificateAsync(ctx.graphqlClient, this.app.account, {
        certP12: certificateP12,
        certPassword: certificatePassword,
        teamId: appleTeam.appleTeamIdentifier,
        teamName: appleTeam.appleTeamName ?? undefined,
      });
    }

    const isSameCertificate = currentDistributionCertificate.certificateP12 === certificateP12;
    if (!isSameCertificate) {
      return await ctx.ios.createDistributionCertificateAsync(ctx.graphqlClient, this.app.account, {
        certP12: certificateP12,
        certPassword: certificatePassword,
        teamId: appleTeam.appleTeamIdentifier,
        teamName: appleTeam.appleTeamName ?? undefined,
      });
    }

    // If the configured Distribution Certificate is the same as the new one, just use the currently configured certificate
    return currentDistributionCertificate;
  }

  async getProvisioningProfileToAssignAsync(
    ctx: CredentialsContext,
    appleTeam: AppleTeamFragment,
    currentProvisioningProfile: AppleProvisioningProfileFragment | null
  ): Promise<AppleProvisioningProfileFragment> {
    const { provisioningProfile } = this.targetCredentials;

    if (!currentProvisioningProfile) {
      return await this.createNewProvisioningProfileAsync(ctx, appleTeam);
    }

    const isSameProfile = currentProvisioningProfile.provisioningProfile === provisioningProfile;
    if (!isSameProfile) {
      return await this.createNewProvisioningProfileAsync(ctx, appleTeam);
    }

    // If the configured Provisioning Profile is the same as the new one, just use the currently configured profile
    return currentProvisioningProfile;
  }

  async createNewProvisioningProfileAsync(
    ctx: CredentialsContext,
    appleTeam: AppleTeamFragment
  ): Promise<AppleProvisioningProfileFragment> {
    const { provisioningProfile } = this.targetCredentials;

    const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
      ctx.graphqlClient,
      this.app,
      appleTeam
    );
    return await ctx.ios.createProvisioningProfileAsync(
      ctx.graphqlClient,
      this.app,
      appleAppIdentifier,
      {
        appleProvisioningProfile: provisioningProfile,
      }
    );
  }
}

function displaySingleTargetProjectCredentials(
  app: AppLookupParams,
  buildCredentials: IosAppBuildCredentialsFragment
): void {
  const targetName = app.projectName;
  displayProjectCredentials(app, { [targetName]: buildCredentials }, [
    { targetName, bundleIdentifier: app.bundleIdentifier },
  ]);
}
