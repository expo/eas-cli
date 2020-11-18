import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
  PushKey,
  PushKeyStoreInfo,
} from './Credentials.types';
import { AuthCtx, authenticateAsync } from './authenticate';
import { checkWSLAsync } from './checkWSL';
import {
  AppleTooManyCertsError,
  createDistributionCertificateAsync,
  listDistributionCertificatesAsync,
  revokeDistributionCertificateAsync,
} from './distributionCertificate';
import { AppLookupParams, EnsureAppExistsOptions, ensureAppExistsAsync } from './ensureAppExists';
import { USE_APPLE_UTILS } from './experimental';
import {
  createProvisioningProfileAsync,
  listProvisioningProfilesAsync,
  revokeProvisioningProfileAsync,
  useExistingProvisioningProfileAsync,
} from './provisioningProfile';
import { createOrReuseAdhocProvisioningProfileAsync } from './provisioningProfileAdhoc';
import { createPushKeyAsync, listPushKeysAsync, revokePushKeyAsync } from './pushKey';

interface Options {
  appleIdPassword?: string;
  appleId?: string;
  teamId?: string;
}

export { AppleTooManyCertsError };

class AppStoreApi {
  private _authCtx?: AuthCtx;

  constructor(public readonly options?: Options) {}

  public get authCtx(): AuthCtx | undefined {
    return this._authCtx;
  }

  public async ensureAuthenticatedAsync(): Promise<AuthCtx> {
    if (!this._authCtx) {
      if (!USE_APPLE_UTILS) {
        // Only check Fastlane compat when using Fastlane (default).
        await checkWSLAsync();
      }
      this._authCtx = await authenticateAsync(this.options);
    }
    return this._authCtx;
  }

  public async ensureAppExistsAsync(
    app: AppLookupParams,
    options?: EnsureAppExistsOptions
  ): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await ensureAppExistsAsync(ctx, app, options);
  }

  public async listDistributionCertificatesAsync(): Promise<DistributionCertificateStoreInfo[]> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await listDistributionCertificatesAsync(ctx);
  }

  public async createDistributionCertificateAsync(): Promise<DistributionCertificate> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createDistributionCertificateAsync(ctx);
  }

  public async revokeDistributionCertificateAsync(ids: string[]): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await revokeDistributionCertificateAsync(ctx, ids);
  }

  public async listPushKeysAsync(): Promise<PushKeyStoreInfo[]> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await listPushKeysAsync(ctx);
  }

  public async createPushKeyAsync(name?: string): Promise<PushKey> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createPushKeyAsync(ctx, name);
  }

  public async revokePushKeyAsync(ids: string[]): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await revokePushKeyAsync(ctx, ids);
  }

  public async useExistingProvisioningProfileAsync(
    bundleIdentifier: string,
    provisioningProfile: ProvisioningProfile,
    distCert: DistributionCertificate
  ): Promise<ProvisioningProfile> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await useExistingProvisioningProfileAsync(
      ctx,
      bundleIdentifier,
      provisioningProfile,
      distCert
    );
  }

  public async listProvisioningProfilesAsync(
    bundleIdentifier: string
  ): Promise<ProvisioningProfileStoreInfo[]> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await listProvisioningProfilesAsync(ctx, bundleIdentifier);
  }

  public async createProvisioningProfileAsync(
    bundleIdentifier: string,
    distCert: DistributionCertificate,
    profileName: string
  ): Promise<ProvisioningProfile> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createProvisioningProfileAsync(ctx, bundleIdentifier, distCert, profileName);
  }

  public async revokeProvisioningProfileAsync(bundleIdentifier: string): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await revokeProvisioningProfileAsync(ctx, bundleIdentifier);
  }

  public async createOrReuseAdhocProvisioningProfileAsync(
    udids: string[],
    bundleIdentifier: string,
    distCertSerialNumber: string
  ): Promise<ProvisioningProfile> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createOrReuseAdhocProvisioningProfileAsync(
      ctx,
      udids,
      bundleIdentifier,
      distCertSerialNumber
    );
  }
}
export default AppStoreApi;
