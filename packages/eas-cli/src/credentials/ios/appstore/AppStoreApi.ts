import Log from '../../../log';
import {
  AscApiKey,
  AscApiKeyInfo,
  DistributionCertificate,
  DistributionCertificateStoreInfo,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
  PushKey,
  PushKeyStoreInfo,
} from './Credentials.types';
import {
  createAscApiKeyAsync,
  getAscApiKeyAsync,
  listAscApiKeysAsync,
  revokeAscApiKeyAsync,
} from './ascApiKey';
import {
  Options as AuthenticateOptions,
  assertUserAuthCtx,
  authenticateAsync,
  isUserAuthCtx,
} from './authenticate';
import { AuthCtx, AuthenticationMode, UserAuthCtx } from './authenticateTypes';
import {
  createDistributionCertificateAsync,
  listDistributionCertificatesAsync,
  revokeDistributionCertificateAsync,
} from './distributionCertificate';
import {
  AppLookupParams,
  IosCapabilitiesOptions,
  ensureBundleIdExistsAsync,
} from './ensureAppExists';
import {
  ProfileClass,
  createProvisioningProfileAsync,
  listProvisioningProfilesAsync,
  revokeProvisioningProfileAsync,
  useExistingProvisioningProfileAsync,
} from './provisioningProfile';
import { createOrReuseAdhocProvisioningProfileAsync } from './provisioningProfileAdhoc';
import { createPushKeyAsync, listPushKeysAsync, revokePushKeyAsync } from './pushKey';
import { hasAscEnvVars } from './resolveCredentials';

export default class AppStoreApi {
  public authCtx?: AuthCtx;
  public defaultAuthenticationMode: AuthenticationMode;

  constructor() {
    this.defaultAuthenticationMode = hasAscEnvVars()
      ? AuthenticationMode.API_KEY
      : AuthenticationMode.USER;
  }

  public async ensureUserAuthenticatedAsync(options?: AuthenticateOptions): Promise<UserAuthCtx> {
    if (this.authCtx && !isUserAuthCtx(this.authCtx)) {
      // already authenticated, but with the wrong type
      Log.log(`Only user authentication is supported. Reauthenticating as user...`);
      this.authCtx = undefined;
    }

    const updatedAuthCtx = await this.ensureAuthenticatedAsync({
      ...options,
      mode: AuthenticationMode.USER,
    });
    return assertUserAuthCtx(updatedAuthCtx);
  }

  public async ensureAuthenticatedAsync(options?: AuthenticateOptions): Promise<AuthCtx> {
    if (!this.authCtx) {
      this.authCtx = await authenticateAsync(options);
    }
    return this.authCtx;
  }

  public async ensureBundleIdExistsAsync(
    app: AppLookupParams,
    options?: IosCapabilitiesOptions
  ): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await ensureBundleIdExistsAsync(ctx, app, options);
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
    const userCtx = await this.ensureUserAuthenticatedAsync();
    return await listPushKeysAsync(userCtx);
  }

  public async createPushKeyAsync(name?: string): Promise<PushKey> {
    const userCtx = await this.ensureUserAuthenticatedAsync();
    return await createPushKeyAsync(userCtx, name);
  }

  public async revokePushKeyAsync(ids: string[]): Promise<void> {
    const userCtx = await this.ensureUserAuthenticatedAsync();
    return await revokePushKeyAsync(userCtx, ids);
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
    bundleIdentifier: string,
    profileClass?: ProfileClass
  ): Promise<ProvisioningProfileStoreInfo[]> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await listProvisioningProfilesAsync(ctx, bundleIdentifier, profileClass);
  }

  public async createProvisioningProfileAsync(
    bundleIdentifier: string,
    distCert: DistributionCertificate,
    profileName: string,
    profileClass?: ProfileClass
  ): Promise<ProvisioningProfile> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createProvisioningProfileAsync(
      ctx,
      bundleIdentifier,
      distCert,
      profileName,
      profileClass
    );
  }

  public async revokeProvisioningProfileAsync(
    bundleIdentifier: string,
    profileClass?: ProfileClass
  ): Promise<void> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await revokeProvisioningProfileAsync(ctx, bundleIdentifier, profileClass);
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

  public async listAscApiKeysAsync(): Promise<AscApiKeyInfo[]> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await listAscApiKeysAsync(ctx);
  }

  public async getAscApiKeyAsync(keyId: string): Promise<AscApiKeyInfo | null> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await getAscApiKeyAsync(ctx, keyId);
  }

  public async createAscApiKeyAsync({ nickname }: { nickname: string }): Promise<AscApiKey> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await createAscApiKeyAsync(ctx, { nickname });
  }

  public async revokeAscApiKeyAsync(keyId: string): Promise<AscApiKeyInfo> {
    const ctx = await this.ensureAuthenticatedAsync();
    return await revokeAscApiKeyAsync(ctx, keyId);
  }
}
