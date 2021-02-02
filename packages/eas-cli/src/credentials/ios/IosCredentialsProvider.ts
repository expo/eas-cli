import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, DistributionType } from '@expo/eas-json';

import { IosDistributionType } from '../../graphql/generated';
import Log from '../../log';
import { findAccountByName } from '../../user/Account';
import { CredentialsManager } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import type { IosCredentials } from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';

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
  distribution: DistributionType;
  skipCredentialsCheck?: boolean;
}

interface AppLookupParams {
  projectName: string;
  accountName: string;
  bundleIdentifier: string;
}

export default class IosCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.iOS;

  constructor(private ctx: Context, private options: Options) {}

  public async hasRemoteAsync(): Promise<boolean> {
    const { distributionCertificate, provisioningProfile } = await this.fetchRemoteAsync();
    return !!(
      distributionCertificate?.certP12 ||
      distributionCertificate?.certPassword ||
      provisioningProfile
    );
  }

  public async hasLocalAsync(): Promise<boolean> {
    if (this.options.distribution === DistributionType.INTERNAL) {
      // TODO: add support for using credentials.json for internal distribution
      return false;
    }
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
    if (this.options.distribution === DistributionType.INTERNAL) {
      // TODO: add support for using credentials.json for internal distribution
      throw new Error('Using credentials.json for internal distribution is not supported yet.');
    }
    return await credentialsJsonReader.readIosCredentialsAsync(this.ctx.projectDir);
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
    if (this.options.distribution === DistributionType.INTERNAL) {
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

      // for now, let's require the user to authenticate with Apple
      const { team } = await this.ctx.appStore.ensureAuthenticatedAsync();
      const appleTeam = await this.ctx.newIos.createOrGetExistingAppleTeamAsync(appLookupParams, {
        appleTeamIdentifier: team.id,
        appleTeamName: team.name,
      });
      const [distCert, provisioningProfile] = await Promise.all([
        this.ctx.newIos.getDistributionCertificateForAppAsync(
          appLookupParams,
          appleTeam,
          IosDistributionType.AdHoc
        ),
        this.ctx.newIos.getProvisioningProfileAsync(
          appLookupParams,
          appleTeam,
          IosDistributionType.AdHoc
        ),
      ]);
      return {
        provisioningProfile: provisioningProfile?.provisioningProfile ?? undefined,
        distributionCertificate: {
          certP12: distCert?.certificateP12 ?? undefined,
          certPassword: distCert?.certificatePassword ?? undefined,
        },
      };
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
