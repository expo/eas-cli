import keyBy from 'lodash/keyBy';

import { AndroidCredentials, FcmCredentials, Keystore } from '../credentials';
import ApiClient from './gotWrapper';

export default class AndroidApi {
  private client = new ApiClient();
  private shouldRefetchAll: boolean = true;
  private credentials: { [key: string]: AndroidCredentials } = {};

  public async fetchAllAsync(): Promise<{ [key: string]: AndroidCredentials }> {
    if (this.shouldRefetchAll) {
      this.credentials = keyBy(await this.client.getAllCredentialsApi(), 'experienceName');
      this.shouldRefetchAll = false;
    }
    return this.credentials;
  }

  public async fetchKeystoreAsync(experienceName: string): Promise<Keystore | null> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    return this.credentials[experienceName]?.keystore || null;
  }

  public async fetchCredentialsAsync(experienceName: string): Promise<AndroidCredentials> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    return this.credentials[experienceName];
  }

  public async updateKeystoreAsync(experienceName: string, keystore: Keystore): Promise<void> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    await this.client.updateKeystoreApi(experienceName, keystore);
    this.credentials[experienceName] = {
      experienceName,
      keystore,
      pushCredentials: this.credentials[experienceName]?.pushCredentials,
    };
  }

  public async fetchFcmKeyAsync(experienceName: string): Promise<FcmCredentials | null> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    return this.credentials?.[experienceName]?.pushCredentials;
  }

  public async updateFcmKeyAsync(experienceName: string, fcmApiKey: string): Promise<void> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    await this.client.updateFcmKeyApi(experienceName, fcmApiKey);
    this.credentials[experienceName] = {
      experienceName,
      keystore: this.credentials[experienceName]?.keystore,
      pushCredentials: { fcmApiKey },
    };
  }

  public async removeFcmKeyAsync(experienceName: string): Promise<void> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    await this.client.removeFcmKeyApi(experienceName);
    if (this.credentials[experienceName]) {
      this.credentials[experienceName].pushCredentials = null;
    }
  }

  public async removeKeystoreAsync(experienceName: string): Promise<void> {
    await this.ensureCredentialsFetchedAsync(experienceName);
    await this.client.removeKeystoreApi(experienceName);
    if (this.credentials[experienceName]) {
      this.credentials[experienceName].keystore = null;
    }
  }

  private async ensureCredentialsFetchedAsync(experienceName: string): Promise<void> {
    if (!this.credentials[experienceName]) {
      const response = await this.client.getAllCredentialsForAppApi(experienceName);
      this.credentials[experienceName] = {
        experienceName,
        keystore: response?.keystore,
        pushCredentials: response?.pushCredentials,
      };
    }
  }
}
