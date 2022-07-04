import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { CommonIosAppCredentialsFragment } from '../../graphql/generated.js';
import Log from '../../log.js';
import { findApplicationTarget } from '../../project/ios/target.js';
import { confirmAsync } from '../../prompts.js';
import { CredentialsContext } from '../context.js';
import * as credentialsJsonReader from '../credentialsJson/read.js';
import { ensureAllTargetsAreConfigured } from '../credentialsJson/utils.js';
import { getAppFromContext } from './actions/BuildCredentialsUtils.js';
import { SetUpBuildCredentials } from './actions/SetUpBuildCredentials.js';
import { SetUpPushKey } from './actions/SetUpPushKey.js';
import { App, IosCredentials, Target } from './types.js';
import { isAdHocProfile } from './utils/provisioningProfile.js';

interface Options {
  app: App;
  targets: Target[];
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
}

export default class IosCredentialsProvider {
  public readonly platform = Platform.IOS;

  constructor(private ctx: CredentialsContext, private options: Options) {}

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
    return await new SetUpBuildCredentials({
      app: this.options.app,
      targets: this.options.targets,
      distribution: this.options.distribution,
      enterpriseProvisioning: this.options.enterpriseProvisioning,
    }).runAsync(this.ctx);
  }

  private async getPushKeyAsync(
    ctx: CredentialsContext,
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

    const setupPushKeyAction = new SetUpPushKey(appLookupParams);
    const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
    if (isPushKeySetup) {
      Log.succeed(
        `Push Notifications setup for ${app.projectName}: ${applicationTarget.bundleIdentifier}`
      );
      return null;
    }

    const confirmSetup = await confirmAsync({
      message: `Would you like to set up Push Notifications for your project?`,
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
