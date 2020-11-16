import assert from 'assert';
import keyBy from 'lodash/keyBy';
import omit from 'lodash/omit';
import pick from 'lodash/pick';

import {
  DistributionCertificate,
  ProvisioningProfile,
  PushKey,
} from '../appstore/Credentials.types';
import {
  AppLookupParams,
  IosAppCredentials,
  IosCredentials,
  IosDistCredentials,
  IosPushCredentials,
} from '../credentials';
import ApiClient from './ClientWrapper';

type CredentialFields = {
  credentials: { [key: string]: any };
};

// appCredentials are identified by `${projectFullName} ${bundleIdentifier}` (see getAppCredentialsCacheIndex method)
// userCredentials are identified by id (string or numeric depending on API)
//
// Expected behaviour of cache (internals)
//
// - when isPrefetched[accountName] true assume everything is synced for that account
// - when credentials[accountName].appCredentials[experienceNameBundleIdentifier] is truthy assume that user and app credentials for that app are synced
// - when accessing user or app credentials identified by AppLookupParams fetch all credentials for that app (user and app credentials)
// - when updating userCredentials refetch only userCredentials
// - when deleting userCredentials modify prefetched appCredentials without calling api
// - when updating provisioningProfile refetch all credentials for that app (user and app crednetials)
// - when deleting provisioningProfile modify appCredentials in cache
// - when deleting pushCert refetch all credentials for app (app + user)
//
//
interface CredentialsCache {
  [accountName: string]: {
    appCredentials: {
      [experienceNameBundleIdentifier: string]: IosAppCredentials;
    };
    userCredentials: {
      [id: string]: IosDistCredentials | IosPushCredentials;
    };
  };
}

export default class iOSApi {
  client = new ApiClient();
  credentials: CredentialsCache = {};
  isPrefetched: { [accountName: string]: boolean } = {};

  public async getAllCredentialsAsync(accountName: string): Promise<IosCredentials> {
    if (!this.isPrefetched[accountName]) {
      const credentials = await this.client.getAllCredentialsApi(accountName);
      this.credentials[accountName] = {
        appCredentials: keyBy(
          credentials.appCredentials,
          cred => `${cred.experienceName} ${cred.bundleIdentifier}`
        ),
        userCredentials: keyBy(credentials.userCredentials, cred => String(cred.id)),
      };
      this.isPrefetched[accountName] = true;
    }
    return {
      appCredentials: Object.values(this.credentials[accountName]?.appCredentials ?? {}),
      userCredentials: Object.values(this.credentials[accountName]?.userCredentials ?? {}),
    };
  }

  public async getDistributionCertificateAsync(
    appLookupParams: AppLookupParams
  ): Promise<IosDistCredentials | null> {
    await this.ensureAppCredentialsAsync(appLookupParams);
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    const appCredentials = this.credentials[accountName]?.appCredentials?.[appCredentialsIndex];
    if (!appCredentials || !appCredentials.distCredentialsId) {
      return null;
    }

    const distCert = this.credentials[accountName]?.userCredentials?.[
      appCredentials.distCredentialsId
    ] as IosDistCredentials | null;
    return distCert ?? null;
  }

  public async getDistributionCertificateByIdAsync(
    id: string | number,
    accountName: string
  ): Promise<IosDistCredentials> {
    if (!this.credentials[accountName]?.userCredentials?.[String(id)]) {
      await this.refetchUserCredentialsAsync(id, accountName);
    }

    const distCert = this.credentials[accountName]?.userCredentials?.[String(id)];
    assert(id && distCert, 'distribution certificate does not exists');
    assert(distCert.type === 'dist-cert', 'wrong type of user credential');
    return distCert as IosDistCredentials;
  }

  public async createDistributionCertificateAsync(
    accountName: string,
    credentials: DistributionCertificate
  ): Promise<IosDistCredentials> {
    const id = await this.client.createDistributionCertificateApi(accountName, credentials);

    // refetching because www might add some fields (e.g. certSerialNumber)
    await this.refetchUserCredentialsAsync(id, accountName);

    const distCert = this.credentials[accountName]?.userCredentials?.[String(id)];
    assert(id && distCert, 'distribution certificate does not exists');
    assert(distCert.type === 'dist-cert', 'wrong type of user credential');
    return distCert as IosDistCredentials;
  }

  public async updateDistributionCertificateAsync(
    id: number | string,
    accountName: string,
    credentials: DistributionCertificate
  ): Promise<IosDistCredentials> {
    await this.client.updateDistributionCertificateApi(id, accountName, credentials);

    // refetching because www might add some fields (e.g. certSerialNumber)
    await this.refetchUserCredentialsAsync(id, accountName);

    const distCert = this.credentials[accountName]?.userCredentials[String(id)];
    assert(distCert, 'distribution certificate does not exists');
    assert(distCert.type === 'dist-cert', 'wrong type of user credential');
    return distCert as IosDistCredentials;
  }

  public async deleteDistributionCertificateAsync(
    id: number | string,

    accountName: string
  ): Promise<void> {
    await this.client.deleteDistributionCertificateApi(id, accountName);
    await this.removeUserCredentialFromCache(id, accountName);
  }

  public async useDistributionCertificateAsync(
    appLookupParams: AppLookupParams,
    userCredentialsId: number | string
  ): Promise<void> {
    await this.client.useDistributionCertificateApi(appLookupParams, userCredentialsId);
    await this.refetchAppCredentialsAsync(appLookupParams);
  }

  public async createPushKeyAsync(
    accountName: string,
    credentials: PushKey
  ): Promise<IosPushCredentials> {
    const id = await this.client.createPushKeyApi(accountName, credentials);

    await this.refetchUserCredentialsAsync(id, accountName);

    const pushKey = this.credentials[accountName]?.userCredentials?.[String(id)];
    assert(id && pushKey, 'push key does not exists');
    assert(pushKey.type === 'push-key', 'wrong type of user credentials');
    return pushKey;
  }

  public async updatePushKeyAsync(
    id: number | string,
    accountName: string,
    credentials: PushKey
  ): Promise<IosPushCredentials> {
    await this.client.updatePushKeyApi(id, accountName, credentials);

    await this.refetchUserCredentialsAsync(id, accountName);

    const pushKey = this.credentials[accountName]?.userCredentials?.[String(id)];
    assert(id && pushKey, 'push key does not exists');
    assert(pushKey.type === 'push-key', 'wrong type of user credentials');
    return pushKey;
  }

  public async deletePushKeyAsync(id: number | string, accountName: string) {
    await this.client.deletePushKeyApi(id, accountName);
    await this.removeUserCredentialFromCache(id, accountName);
  }

  public async getPushKeyAsync(
    appLookupParams: AppLookupParams
  ): Promise<IosPushCredentials | null> {
    await this.ensureAppCredentialsAsync(appLookupParams);
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    const appCredentials = this.credentials[accountName]?.appCredentials?.[appCredentialsIndex];
    if (!appCredentials || !appCredentials.pushCredentialsId) {
      return null;
    }

    const pushKey = this.credentials[accountName]?.userCredentials?.[
      appCredentials.pushCredentialsId
    ] as IosPushCredentials | null;
    return pushKey ?? null;
  }

  public async usePushKeyAsync(
    appLookupParams: AppLookupParams,
    userCredentialsId: number | string
  ): Promise<void> {
    await this.client.usePushKeyApi(appLookupParams, userCredentialsId);
    await this.refetchAppCredentialsAsync(appLookupParams);
  }

  public async getPushCertAsync(
    appLookupParams: AppLookupParams
  ): Promise<{ pushId: string; pushP12: string; pushPassword: string } | null> {
    const appCredentials = await this.getAppCredentialsAsync(appLookupParams);
    const pushId = appCredentials?.credentials?.pushId;
    const pushP12 = appCredentials?.credentials?.pushP12;
    const pushPassword = appCredentials?.credentials?.pushPassword;
    if (!pushId || !pushP12 || !pushPassword) {
      return null;
    }
    return { pushId, pushP12, pushPassword };
  }

  public async deletePushCertAsync(appLookupParams: AppLookupParams): Promise<void> {
    await this.client.deletePushCertApi(appLookupParams);
    await this.refetchAppCredentialsAsync(appLookupParams);
  }

  public async getAppCredentialsAsync(
    appLookupParams: AppLookupParams
  ): Promise<IosAppCredentials> {
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    await this.ensureAppCredentialsAsync(appLookupParams);
    return this.credentials[accountName]?.appCredentials?.[appCredentialsIndex];
  }

  public async getProvisioningProfileAsync(
    appLookupParams: AppLookupParams
  ): Promise<ProvisioningProfile | null> {
    const appCredentials = await this.getAppCredentialsAsync(appLookupParams);
    const provisioningProfile = appCredentials?.credentials?.provisioningProfile;
    if (!provisioningProfile) {
      return null;
    }
    return pick(appCredentials.credentials, [
      'provisioningProfile',
      'provisioningProfileId',
      'teamId',
      'teamName',
    ]) as ProvisioningProfile;
  }

  public async updateProvisioningProfileAsync(
    appLookupParams: AppLookupParams,
    provisioningProfile: ProvisioningProfile
  ): Promise<ProvisioningProfile> {
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    await this.client.updateProvisioningProfileApi(appLookupParams, provisioningProfile);
    await this.refetchAppCredentialsAsync(appLookupParams);
    return pick(this.credentials[accountName]?.appCredentials?.[appCredentialsIndex]?.credentials, [
      'provisioningProfile',
      'provisioningProfileId',
      'teamId',
      'teamName',
    ]) as ProvisioningProfile;
  }

  public async deleteProvisioningProfileAsync(appLookupParams: AppLookupParams): Promise<void> {
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    await this.client.deleteProvisioningProfileApi(appLookupParams);
    const appCredentials = this.credentials?.[accountName]?.appCredentials?.[appCredentialsIndex];
    if (appCredentials?.credentials) {
      // teamId should still be there becaus it might be part of push cert definition
      appCredentials.credentials = omit(appCredentials.credentials, [
        'provisioningProfile',
        'provisioningProfileId',
      ]);
    }
  }

  private getAppCredentialsCacheIndex(appLookupParams: AppLookupParams): string {
    const { accountName, projectName, bundleIdentifier } = appLookupParams;
    const projectFullName = `@${accountName}/${projectName}`;
    return `${projectFullName} ${bundleIdentifier}`;
  }

  private removeUserCredentialFromCache(id: number | string, accountName: string): void {
    if (this.credentials[accountName]?.userCredentials?.[String(id)]) {
      delete this.credentials[accountName].userCredentials[String(id)];
    }
    const appCredentials = this.credentials[accountName]?.appCredentials;
    if (appCredentials) {
      for (const cred of Object.values(appCredentials)) {
        if (cred.distCredentialsId === id) {
          delete cred.distCredentialsId;
        }
        if (cred.pushCredentialsId === id) {
          delete cred.pushCredentialsId;
        }
      }
    }
  }

  // ensures that credentials are fetched from the server if they exist
  // if there are no credentials on server for specific app this function should still succeed
  private async ensureAppCredentialsAsync(appLookupParams: AppLookupParams): Promise<void> {
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(appLookupParams);
    const { accountName } = appLookupParams;

    if (
      this.isPrefetched[accountName] ||
      this.credentials?.[accountName]?.appCredentials?.[appCredentialsIndex]
    ) {
      return;
    }
    await this.refetchAppCredentialsAsync(appLookupParams);
  }

  private async refetchUserCredentialsAsync(
    id: number | string,
    accountName: string
  ): Promise<void> {
    const userCredentials = await this.client.getUserCredentialsByIdApi(id, accountName);
    if (!userCredentials || !userCredentials.id) {
      return;
    }
    this.credentials[accountName] = {
      ...this.credentials[accountName],
      userCredentials: {
        ...this.credentials[accountName]?.userCredentials,
        [String(id)]: userCredentials,
      },
    };
  }

  private async refetchAppCredentialsAsync(app: AppLookupParams): Promise<void> {
    const { accountName } = app;
    const appCredentialsIndex = this.getAppCredentialsCacheIndex(app);
    const data = await this.client.getAllCredentialsForAppApi(app);
    if (!data) {
      return;
    }
    this.credentials[accountName] = {
      appCredentials: {
        ...this.credentials[accountName]?.appCredentials,
        [appCredentialsIndex]: omit(data, [
          'pushCredentials',
          'distCredentials',
        ]) as IosAppCredentials,
      },
      userCredentials: {
        ...this.credentials[accountName]?.userCredentials,
        ...(data.pushCredentialsId
          ? {
              [String(data.pushCredentialsId)]: {
                ...data.pushCredentials,
                id: data.pushCredentialsId,
                type: 'push-key',
              },
            }
          : {}),
        ...(data.distCredentialsId
          ? {
              [String(data.distCredentialsId)]: {
                ...data.distCredentials,
                id: data.distCredentialsId,
                type: 'dist-cert',
              },
            }
          : {}),
      },
    };
  }
}
