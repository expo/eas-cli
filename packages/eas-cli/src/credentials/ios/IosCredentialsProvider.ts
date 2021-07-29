import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { CommonIosAppCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { findApplicationTarget } from '../../project/ios/target';
import { confirmAsync } from '../../prompts';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import { ensureAllTargetsAreConfigured } from '../credentialsJson/utils';
import { getAppFromContext } from './actions/BuildCredentialsUtils';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { SetupPushKey } from './actions/SetupPushKey';
import { IosCapabilitiesOptions } from './appstore/ensureAppExists';
import { App, IosCredentials, Target } from './types';
import { isAdHocProfile } from './utils/provisioningProfile';

interface Options {
  app: App;
  targets: Target[];
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  iosCapabilitiesOptions?: IosCapabilitiesOptions;
}

export default class IosCredentialsProvider {
  public readonly platform = Platform.IOS;

  constructor(private ctx: Context, private options: Options) {}

  public async getCredentialsAsync(
    src: CredentialsSource.LOCAL | CredentialsSource.REMOTE
  ): Promise<IosCredentials> {
    let buildCredentials;
    if (src === CredentialsSource.LOCAL) {
      buildCredentials = await this.getLocalAsync();
    } else {
      buildCredentials = await this.getRemoteAsync();
    }
    await this.getPushKeyAsync(this.ctx, this.options.targets);
    return buildCredentials;
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

  private async getPushKeyAsync(
    ctx: Context,
    targets: Target[]
  ): Promise<CommonIosAppCredentialsFragment | null> {
    if (ctx.nonInteractive) {
      return null;
    }

    const applicationTarget = findApplicationTarget(targets);
    const app = getAppFromContext(ctx);
    const appLookupParams = {
      ...app,
      bundleIdentifier: applicationTarget.bundleIdentifier,
      parentBundleIdentifier: applicationTarget.parentBundleIdentifier,
    };

    const setupPushKeyAction = new SetupPushKey(appLookupParams);
    const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
    if (isPushKeySetup) {
      Log.succeed(
        `Push Notifications setup for ${app.projectName}:${applicationTarget.bundleIdentifier}`
      );
      return null;
    }

    const confirmSetup = await confirmAsync({
      message: `Would you like to setup Push Notifications for your project?`,
    });
    if (!confirmSetup) {
      return null;
    }
    return await setupPushKeyAction.runAsync(ctx);
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
