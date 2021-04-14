import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, iOSDistributionType } from '@expo/eas-json';

import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../graphql/generated';
import Log from '../../log';
import { CredentialsManager } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import type { IosCredentials } from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { getBuildCredentialsAsync } from './actions/new/BuildCredentialsUtils';
import { AppLookupParams } from './api/GraphqlClient';
import { isAdHocProfile } from './utils/provisioningProfile';

export type { IosCredentials };

interface Options {
  app: AppLookupParams;
  distribution: iOSDistributionType;
  skipCredentialsCheck?: boolean;
}

export default class IosCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.IOS;

  constructor(private ctx: Context, private options: Options) {}

  public async hasRemoteAsync(): Promise<boolean> {
    // TODO: this is temporary
    // remove this check when we implement syncing local credentials for internal distribution
    if (this.options.distribution === 'internal' && (await this.hasLocalAsync())) {
      return false;
    }
    const buildCredentials = await this.fetchRemoteAsync();
    return !!(
      buildCredentials?.distributionCertificate?.certificateP12 ||
      buildCredentials?.distributionCertificate?.certificatePassword ||
      buildCredentials?.provisioningProfile?.provisioningProfile
    );
  }

  public async hasLocalAsync(): Promise<boolean> {
    if (!(await credentialsJsonReader.fileExistsAsync(this.ctx.projectDir))) {
      return false;
    }
    try {
      const rawCredentialsJson = await credentialsJsonReader.readRawAsync(this.ctx.projectDir);
      return !!rawCredentialsJson?.ios;
    } catch (err) {
      Log.error(err); // malformed json
      return false;
    }
  }

  public async isLocalSyncedAsync(): Promise<boolean> {
    try {
      const [remote, local] = await Promise.all([this.fetchRemoteAsync(), this.getLocalAsync()]);
      const r = remote;
      const l = local;

      // TODO
      // For now, when credentials.json contains credentials for multi-target project
      // assume they are synced with the Expo servers.
      // Change this behavior when we figure out how to store multi-target project credentials in the db.
      if (credentialsJsonReader.isCredentialsMap(l)) {
        return true;
      }

      return !!(
        r &&
        l &&
        r.provisioningProfile?.provisioningProfile === l.provisioningProfile &&
        r.distributionCertificate?.certificateP12 === l.distributionCertificate.certP12 &&
        r.distributionCertificate?.certificatePassword === l.distributionCertificate.certPassword
      );
    } catch (_) {
      return false;
    }
  }

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
        new SetupBuildCredentials(this.options.app, this.options.distribution)
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
    const distributionType =
      this.options.distribution === 'internal'
        ? IosDistributionType.AdHoc
        : IosDistributionType.AppStore;
    return await getBuildCredentialsAsync(this.ctx, this.options.app, distributionType);
  }
}
