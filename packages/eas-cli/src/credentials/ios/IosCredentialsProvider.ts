import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { IosAppBuildCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { CredentialsManager } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import type { IosCredentials } from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import {
  getBuildCredentialsAsync,
  resolveDistributionType,
} from './actions/new/BuildCredentialsUtils';
import { AppLookupParams } from './api/GraphqlClient';
import { isAdHocProfile } from './utils/provisioningProfile';

export type { IosCredentials };

interface Options {
  app: AppLookupParams;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  skipCredentialsCheck?: boolean;
}

export default class IosCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.IOS;

  constructor(private ctx: Context, private options: Options) {}

  public async getCredentialsAsync(
    src: CredentialsSource.LOCAL | CredentialsSource.REMOTE
  ): Promise<IosCredentials> {
    switch (src) {
      case CredentialsSource.LOCAL:
        return await this.getLocalAsync();
      case CredentialsSource.REMOTE:
        return await this.getRemoteAsync();
    }
  }

  private async getLocalAsync(): Promise<IosCredentials> {
    const credentials = await credentialsJsonReader.readIosCredentialsAsync(this.ctx.projectDir);
    if (credentialsJsonReader.isCredentialsMap(credentials)) {
      for (const targetName of Object.keys(credentials)) {
        this.assertProvisioningProfileType(credentials[targetName].provisioningProfile, targetName);
      }
    } else {
      this.assertProvisioningProfileType(credentials.provisioningProfile);
    }
    return credentials;
  }

  private assertProvisioningProfileType(provisionigProfile: string, targetName?: string) {
    const isAdHoc = isAdHocProfile(provisionigProfile);
    if (this.options.distribution === 'internal' && !isAdHoc) {
      throw new Error(
        `You must use an adhoc provisioning profile${
          targetName ? ` (target '${targetName})'` : ''
        } for internal distribution`
      );
    } else if (this.options.distribution !== 'internal' && isAdHoc) {
      throw new Error(
        `You can't use an adhoc provisioning profile${
          targetName ? ` (target '${targetName}')` : ''
        } for app store distribution`
      );
    }
  }

  private async getRemoteAsync(): Promise<IosCredentials> {
    if (this.options.skipCredentialsCheck) {
      Log.log('Skipping credentials check');
    } else {
      await new CredentialsManager(this.ctx).runActionAsync(
        new SetupBuildCredentials({
          app: this.options.app,
          distribution: this.options.distribution,
          enterpriseProvisioning: this.options.enterpriseProvisioning,
        })
      );
    }

    const buildCredentials = await this.fetchRemoteAsync();
    if (
      !buildCredentials?.distributionCertificate?.certificateP12 ||
      !buildCredentials.distributionCertificate?.certificatePassword
    ) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Distribution certificate is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Distribution certificate is missing');
      }
    }
    if (!buildCredentials.provisioningProfile?.provisioningProfile) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Provisioning profile is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Provisioning profile is missing');
      }
    }
    return {
      provisioningProfile: buildCredentials.provisioningProfile.provisioningProfile,
      distributionCertificate: {
        certP12: buildCredentials.distributionCertificate.certificateP12,
        certPassword: buildCredentials.distributionCertificate.certificatePassword,
      },
    };
  }

  private async fetchRemoteAsync(): Promise<IosAppBuildCredentialsFragment | null> {
    const distributionType = resolveDistributionType(
      this.options.distribution,
      this.options.enterpriseProvisioning
    );
    return await getBuildCredentialsAsync(this.ctx, this.options.app, distributionType);
  }
}
