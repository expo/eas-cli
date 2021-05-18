import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import type { IosCredentials } from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { AppLookupParams } from './api/GraphqlClient';
import { IosCapabilitiesOptions } from './appstore/ensureAppExists';
import { isAdHocProfile } from './utils/provisioningProfile';

export type { IosCredentials };

interface Options {
  app: AppLookupParams;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  iosCapabilitiesOptions?: IosCapabilitiesOptions;
}

export default class IosCredentialsProvider {
  public readonly platform = Platform.IOS;

  constructor(private ctx: Context, private options: Options) {}

  public async getCredentialsAsync(
    src: CredentialsSource.LOCAL | CredentialsSource.REMOTE
  ): Promise<IosCredentials> {
    if (src === CredentialsSource.LOCAL) {
      return await this.getLocalAsync();
    } else {
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

  private assertProvisioningProfileType(provisionigProfile: string, targetName?: string): void {
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
    const manager = new CredentialsManager(this.ctx);
    const { provisioningProfile, distributionCertificate } = await new SetupBuildCredentials({
      app: this.options.app,
      distribution: this.options.distribution,
      enterpriseProvisioning: this.options.enterpriseProvisioning,
      iosCapabilitiesOptions: this.options.iosCapabilitiesOptions,
    }).runAsync(manager, this.ctx);
    return {
      provisioningProfile,
      distributionCertificate: {
        certP12: distributionCertificate.certificateP12,
        certPassword: distributionCertificate.certificatePassword,
      },
    };
  }
}
