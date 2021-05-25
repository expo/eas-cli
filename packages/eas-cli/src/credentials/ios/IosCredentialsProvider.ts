import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import nullthrows from 'nullthrows';

import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
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
    const mainTarget = nullthrows(this.options.targets[0], 'There must be at least one target');

    const iosTargetCredentialsMap = this.enforceIosTargetCredentialsMap(
      await credentialsJsonReader.readIosCredentialsAsync(this.ctx.projectDir),
      mainTarget
    );

    const notConfiguredTargets: string[] = [];
    for (const target of this.options.targets) {
      if (!(target.targetName in iosTargetCredentialsMap)) {
        notConfiguredTargets.push(target.targetName);
        continue;
      }
      this.assertProvisioningProfileType(
        iosTargetCredentialsMap[target.targetName].provisioningProfile,
        target.targetName
      );
    }

    if (notConfiguredTargets.length > 0) {
      throw new Error(
        `Credentials for target${
          notConfiguredTargets.length === 1 ? '' : 's'
        } ${notConfiguredTargets.map(i => `'${i}'`).join(',')} are not defined in credentials.json`
      );
    }

    return iosTargetCredentialsMap;
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

  private enforceIosTargetCredentialsMap(
    iosCredentials: credentialsJsonReader.IosCredentials,
    mainTarget: Target
  ): credentialsJsonReader.IosTargetCredentialsMap {
    if (credentialsJsonReader.isCredentialsMap(iosCredentials)) {
      return iosCredentials;
    } else {
      return {
        [mainTarget.targetName]: iosCredentials,
      };
    }
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
}
