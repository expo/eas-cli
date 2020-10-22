import { CredentialsSource } from '@eas/config';
import { Platform } from '@expo/eas-build-job';

import log from '../../log';
import { runCredentialsManagerAsync } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';

export interface IosCredentials {
  provisioningProfile: string;
  distributionCertificate: {
    certP12: string;
    certPassword: string;
  };
}

interface PartialIosCredentials {
  provisioningProfile?: string;
  distributionCertificate?: {
    certP12?: string;
    certPassword?: string;
  };
}

interface AppLookupParams {
  projectName: string;
  accountName: string;
  bundleIdentifier: string;
}

interface Options {
  nonInteractive: boolean;
  skipCredentialsCheck?: boolean;
}

export default class IosCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.iOS;

  constructor(private ctx: Context, private app: AppLookupParams, private options: Options) {}

  public async hasRemoteAsync(): Promise<boolean> {
    const distCert = await this.ctx.ios.getDistributionCertificateAsync(this.app);
    const provisioningProfile = await this.ctx.ios.getProvisioningProfileAsync(this.app);
    return !!(distCert || provisioningProfile);
  }

  public async hasLocalAsync(): Promise<boolean> {
    return false;
  }

  public async isLocalSyncedAsync(): Promise<boolean> {
    try {
      const [remote, local] = await Promise.all([this.fetchRemoteAsync(), this.getLocalAsync()]);
      const r = remote;
      const l = local as IosCredentials; // ts definion can't resolve return type correctly
      return !!(
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
    throw new Error('not implemented');
  }

  private async getRemoteAsync(): Promise<IosCredentials> {
    if (this.options.skipCredentialsCheck) {
      log('Skipping credentials check');
    } else {
      await runCredentialsManagerAsync(this.ctx, new SetupBuildCredentials(this.app));
    }
    const distCert = await this.ctx.ios.getDistributionCertificateAsync(this.app);
    if (!distCert?.certP12 || !distCert?.certPassword) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Distribution certificate is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Distribution certificate is missing');
      }
    }
    const provisioningProfile = await this.ctx.ios.getProvisioningProfileAsync(this.app);
    if (!provisioningProfile?.provisioningProfile) {
      if (this.options.skipCredentialsCheck) {
        throw new Error(
          'Provisioning profile is missing and credentials check was skipped. Run without --skip-credentials-check to set it up.'
        );
      } else {
        throw new Error('Provisioning profile is missing');
      }
    }
    return {
      provisioningProfile: provisioningProfile.provisioningProfile,
      distributionCertificate: {
        certP12: distCert.certP12,
        certPassword: distCert.certPassword,
      },
    };
  }

  private async fetchRemoteAsync(): Promise<PartialIosCredentials> {
    const distCert = await this.ctx.ios.getDistributionCertificateAsync(this.app);
    const provisioningProfile = await this.ctx.ios.getProvisioningProfileAsync(this.app);
    return {
      provisioningProfile: provisioningProfile?.provisioningProfile,
      distributionCertificate: {
        certP12: distCert?.certP12,
        certPassword: distCert?.certPassword,
      },
    };
  }
}
