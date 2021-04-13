import chalk from 'chalk';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { Context } from '../../../context';
import {
  IosTargetCredentials,
  isCredentialsMap,
  readIosCredentialsAsync,
} from '../../../credentialsJson/read';
import { AppLookupParams } from '../../api/GraphqlClient';
import { getCertData } from '../../utils/p12Certificate';
import { displayProjectCredentials } from '../../utils/printCredentialsBeta';
import { readAppleTeam } from '../../utils/provisioningProfile';
import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getDistributionCertificateAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';
import { formatPkiCertificate } from './DistributionCertificateUtils';

export class SetupBuildCredentialsFromCredentialsJson {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  async getDistributionCertificateToAssignAsync(
    ctx: Context,
    appInfo: string,
    targetCredentials: IosTargetCredentials,
    appleTeam: AppleTeamFragment,
    currentDistributionCertificate: AppleDistributionCertificateFragment | null
  ): Promise<AppleDistributionCertificateFragment> {
    const { distributionCertificate } = targetCredentials;
    const { certP12, certPassword } = distributionCertificate;

    if (!currentDistributionCertificate) {
      return await ctx.newIos.createDistributionCertificateAsync(this.app, {
        certP12,
        certPassword,
        teamId: appleTeam.appleTeamIdentifier,
        teamName: appleTeam.appleTeamName ?? undefined,
      });
    }

    const isSameCertificate = currentDistributionCertificate.certificateP12 === certP12;
    if (!isSameCertificate) {
      const pkiCertificate = getCertData(certP12, certPassword);
      const confirm = await confirmAsync({
        message: `${formatPkiCertificate(
          pkiCertificate
        )} \n  There is already a Distribution Certificate assigned to this project. Would you like to assign this certificate to ${appInfo}?`,
      });
      if (!confirm) {
        throw new Error('Aborting setup of Build Credentials from credentials json');
      }

      return await ctx.newIos.createDistributionCertificateAsync(this.app, {
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

    const appleAppIdentifier = await ctx.newIos.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    return await ctx.newIos.createProvisioningProfileAsync(this.app, appleAppIdentifier, {
      appleProvisioningProfile: provisioningProfile,
    });
  }

  /**
   * We intentionally don't prompt the user if the old and new Provisioning Profiles differ.
   * We assume that they already opted to use the new Distribution Certificate in their credentials
   * json, and the new Provisioning Profile is only compatible with the new Distribution Certificate
   */
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
    const buildCredentials = await getBuildCredentialsAsync(
      ctx,
      this.app,
      IosDistributionType.AppStore
    );
    const currentDistributionCertificate = await getDistributionCertificateAsync(
      ctx,
      this.app,
      IosDistributionType.AppStore
    );
    const currentProfile = await getProvisioningProfileAsync(
      ctx,
      this.app,
      IosDistributionType.AppStore
    );
    const appInfo = `@${this.app.account.name}/${this.app.projectName} (${this.app.bundleIdentifier})`;

    // new credentials from local json
    const appleTeamFromProvisioningProfile = readAppleTeam(localCredentials.provisioningProfile);
    const appleTeam = await ctx.newIos.createOrGetExistingAppleTeamAsync(this.app, {
      appleTeamIdentifier: appleTeamFromProvisioningProfile.teamId,
      appleTeamName: appleTeamFromProvisioningProfile.teamName,
    });
    if (buildCredentials) {
      displayProjectCredentials(this.app, buildCredentials);
    }

    const distributionCertificateToAssign = await this.getDistributionCertificateToAssignAsync(
      ctx,
      appInfo,
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
    const newBuildCredentials = await assignBuildCredentialsAsync(
      ctx,
      this.app,
      this.distributionType,
      distributionCertificateToAssign,
      provisioningProfileToAssign
    );

    displayProjectCredentials(this.app, newBuildCredentials);

    Log.newLine();
    Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
    Log.newLine();
    return newBuildCredentials;
  }
}
