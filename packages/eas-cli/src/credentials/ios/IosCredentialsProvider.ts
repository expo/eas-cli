import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, iOSDistributionType } from '@expo/eas-json';

import { AppleTeamFragment, IosDistributionType } from '../../graphql/generated';
import Log from '../../log';
import { findAccountByName } from '../../user/Account';
import { CredentialsManager } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import type { IosCredentials } from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { resolveAppleTeamIfAuthenticatedAsync } from './actions/new/AppleTeamUtils';
import { AppleUnauthenticatedError, MissingCredentialsNonInteractiveError } from './errors';
import { isAdHocProfile } from './utils/provisioningProfile';

export { IosCredentials };

interface PartialIosCredentials {
  provisioningProfile?: string;
  distributionCertificate?: {
    certP12?: string;
    certPassword?: string;
  };
}

interface Options {
  app: AppLookupParams;
  distribution: iOSDistributionType;
  skipCredentialsCheck?: boolean;
}

interface AppLookupParams {
  projectName: string;
  accountName: string;
  bundleIdentifier: string;
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
    const { distributionCertificate, provisioningProfile } = await this.fetchRemoteAsync();
    return !!(
      distributionCertificate?.certP12 ||
      distributionCertificate?.certPassword ||
      provisioningProfile
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
        r.provisioningProfile === l.provisioningProfile &&
        r.distributionCertificate?.certP12 === l.distributionCertificate.certP12 &&
        r.distributionCertificate?.certPassword === l.distributionCertificate.certPassword
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
          targetName && ` (target '${targetName})'`
        } for internal distribution`
      );
    } else if (this.options.distribution !== 'internal' && isAdHoc) {
      throw new Error(
        `You can't use an adhoc provisioning profile${
          targetName && ` (target '${targetName})'`
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

    const { distributionCertificate, provisioningProfile } = await this.fetchRemoteAsync();
    if (!distributionCertificate?.certP12 || !distributionCertificate?.certPassword) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Distribution certificate is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Distribution certificate is missing');
      }
    }
    if (!provisioningProfile) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Provisioning profile is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Provisioning profile is missing');
      }
    }
    return {
      provisioningProfile,
      distributionCertificate: {
        certP12: distributionCertificate.certP12,
        certPassword: distributionCertificate.certPassword,
      },
    };
  }

  private async fetchRemoteAsync(): Promise<PartialIosCredentials> {
    if (this.options.distribution === 'internal') {
      const { app } = this.options;
      const account = findAccountByName(this.ctx.user.accounts, app.accountName);
      if (!account) {
        throw new Error(`You do not have access to the ${app.accountName} account`);
      }

      const appLookupParams = {
        account,
        bundleIdentifier: this.options.app.bundleIdentifier,
        projectName: this.options.app.projectName,
      };

      let appleTeam: AppleTeamFragment | null = null;
      if (!this.ctx.nonInteractive) {
        await this.ctx.appStore.ensureAuthenticatedAsync();
        appleTeam = await resolveAppleTeamIfAuthenticatedAsync(this.ctx, appLookupParams);
      }

      try {
        const [distCert, provisioningProfile] = await Promise.all([
          this.ctx.newIos.getDistributionCertificateForAppAsync(
            appLookupParams,
            IosDistributionType.AdHoc,
            { appleTeam }
          ),
          this.ctx.newIos.getProvisioningProfileAsync(appLookupParams, IosDistributionType.AdHoc, {
            appleTeam,
          }),
        ]);
        return {
          provisioningProfile: provisioningProfile?.provisioningProfile ?? undefined,
          distributionCertificate: {
            certP12: distCert?.certificateP12 ?? undefined,
            certPassword: distCert?.certificatePassword ?? undefined,
          },
        };
      } catch (err) {
        if (err instanceof AppleUnauthenticatedError && this.ctx.nonInteractive) {
          throw new MissingCredentialsNonInteractiveError();
        }
        throw err;
      }
    } else {
      const [distCert, provisioningProfile] = await Promise.all([
        this.ctx.ios.getDistributionCertificateAsync(this.options.app),
        this.ctx.ios.getProvisioningProfileAsync(this.options.app),
      ]);
      return {
        provisioningProfile: provisioningProfile?.provisioningProfile,
        distributionCertificate: {
          certP12: distCert?.certP12,
          certPassword: distCert?.certPassword,
        },
      };
    }
  }
}
