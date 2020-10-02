import { apiClient } from '../../../api';
import {
  DistributionCertificate,
  ProvisioningProfile,
  PushKey,
} from '../appstore/Credentials.types';
import { IosAppCredentials, IosDistCredentials, IosPushCredentials } from '../credentials';

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

interface IosAllCredentialsForApp extends IosAppCredentials {
  pushCredentials: Omit<IosPushCredentials, 'id' | 'type'>;
  distCredentials: Omit<IosDistCredentials, 'id' | 'type'>;
}

interface AllCredentialsApiResponse {
  appCredentials: IosAppCredentials[];
  userCredentials: (IosDistCredentials | IosPushCredentials)[];
}

// This class should not be used directly, use only as part of cached api client from ./Client.ts
// or mock it in tests (it's easier to mock this class than got directly)
export default class ApiClient {
  public async getAllCredentialsApi(accountName: string): Promise<AllCredentialsApiResponse> {
    const response: any = await apiClient
      .get('credentials/ios', { searchParams: { owner: accountName } })
      .json();
    return response.data;
  }
  public async getAllCredentialsForAppApi({
    accountName,
    projectName,
    bundleIdentifier,
  }: AppLookupParams): Promise<IosAllCredentialsForApp> {
    const response: any = await apiClient
      .get(`credentials/ios/@${accountName}/${projectName}/${bundleIdentifier}`)
      .json();
    return response.data;
  }

  public async getUserCredentialsByIdApi(
    id: number | string,
    accountName: string
  ): Promise<IosDistCredentials | IosPushCredentials> {
    const response: any = await apiClient
      .get(`credentials/ios/userCredentials/${id}`, { searchParams: { owner: accountName } })
      .json();
    return response.data;
  }

  public async createDistributionCertificateApi(
    accountName: string,
    credentials: DistributionCertificate
  ): Promise<number | string> {
    const response: any = await apiClient
      .post('credentials/ios/dist', {
        json: {
          owner: accountName,
          credentials,
        },
      })
      .json();
    return response.data?.id;
  }

  public async updateDistributionCertificateApi(
    id: number | string,
    accountName: string,
    credentials: DistributionCertificate
  ): Promise<void> {
    await apiClient.put(`credentials/ios/dist/${id}`, {
      json: { credentials, owner: accountName },
    });
  }

  public async deleteDistributionCertificateApi(
    id: number | string,
    accountName: string
  ): Promise<void> {
    await apiClient.delete(`credentials/ios/dist/${id}`, { searchParams: { owner: accountName } });
  }

  public async useDistributionCertificateApi(
    { accountName, projectName, bundleIdentifier }: AppLookupParams,
    userCredentialsId: number | string
  ): Promise<void> {
    await apiClient.post('credentials/ios/use/dist', {
      json: {
        experienceName: `@${accountName}/${projectName}`,
        owner: accountName,
        bundleIdentifier,
        userCredentialsId,
      },
    });
  }

  public async createPushKeyApi(
    accountName: string,
    credentials: PushKey
  ): Promise<number | string> {
    const response: any = await apiClient
      .post('credentials/ios/push', {
        json: {
          owner: accountName,
          credentials,
        },
      })
      .json();
    return response.data?.id;
  }

  public async updatePushKeyApi(
    id: number | string,
    accountName: string,
    credentials: PushKey
  ): Promise<IosPushCredentials> {
    const response: any = await apiClient
      .put(`credentials/ios/push/${id}`, {
        json: { owner: accountName },
      })
      .json();
    return response.data;
  }

  public async deletePushKeyApi(id: number | string, accountName: string): Promise<void> {
    await apiClient.delete(`credentials/ios/push/${id}`, { searchParams: { owner: accountName } });
  }

  public async usePushKeyApi(
    { accountName, projectName, bundleIdentifier }: AppLookupParams,
    userCredentialsId: number | string
  ): Promise<void> {
    await apiClient.post('credentials/ios/use/push', {
      json: {
        experienceName: `@${accountName}/${projectName}`,
        owner: accountName,
        bundleIdentifier,
        userCredentialsId,
      },
    });
  }

  public async deletePushCertApi({
    accountName,
    projectName,
    bundleIdentifier,
  }: AppLookupParams): Promise<void> {
    await apiClient.post(`credentials/ios/pushCert/delete`, {
      json: {
        experienceName: `@${accountName}/${projectName}`,
        owner: accountName,
        bundleIdentifier,
      },
    });
  }

  public async updateProvisioningProfileApi(
    { accountName, projectName, bundleIdentifier }: AppLookupParams,
    credentials: ProvisioningProfile
  ): Promise<void> {
    await apiClient.post(`credentials/ios/provisioningProfile/update`, {
      json: {
        experienceName: `@${accountName}/${projectName}`,
        owner: accountName,
        bundleIdentifier,
        credentials,
      },
    });
  }

  public async deleteProvisioningProfileApi({
    accountName,
    projectName,
    bundleIdentifier,
  }: AppLookupParams): Promise<void> {
    await apiClient.post(`credentials/ios/provisioningProfile/delete`, {
      json: {
        experienceName: `@${accountName}/${projectName}`,
        owner: accountName,
        bundleIdentifier,
      },
    });
  }
}
