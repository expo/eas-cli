import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { findApplicationTarget } from '../../project/ios/target';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import { ensureAllTargetsAreConfigured } from '../credentialsJson/utils';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { IosCapabilitiesOptions } from './appstore/ensureAppExists';
import { App, IosCredentials, Target } from './types';
import { isAdHocProfile } from './utils/provisioningProfile';

interface Options {
  app: App;
  targets: Target[];
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
    const applicationTarget = findApplicationTarget(this.options.targets);
    const iosCredentials = await credentialsJsonReader.readIosCredentialsAsync(
      this.ctx.projectDir,
      applicationTarget
    );
    ensureAllTargetsAreConfigured(this.options.targets, iosCredentials);
    for (const target of this.options.targets) {
      this.assertProvisioningProfileType(
        iosCredentials[target.targetName].provisioningProfile,
        target.targetName
      );
    }
    return iosCredentials;
  }

  private async getRemoteAsync(): Promise<IosCredentials> {
    return await new SetupBuildCredentials({
      app: this.options.app,
      targets: this.options.targets,
      distribution: this.options.distribution,
      enterpriseProvisioning: this.options.enterpriseProvisioning,
      iosCapabilitiesOptions: this.options.iosCapabilitiesOptions,
    }).runAsync(this.ctx);
  }

  private assertProvisioningProfileType(provisioningProfile: string, targetName?: string): void {
    const isAdHoc = isAdHocProfile(provisioningProfile);
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
}
