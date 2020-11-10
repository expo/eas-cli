import { apiClient } from '../../../api';
import { AndroidCredentials, Keystore } from '../credentials';

type AllCredentialsApiResponse = AndroidCredentials[];

// This class should not be used directly, use only as part of cached api client from ./Client.ts
// or mock it in tests (it's easier to mock this class than got directly)
export default class ClientWrapper {
  public async getAllCredentialsApi(): Promise<AllCredentialsApiResponse> {
    return ((await apiClient.get('credentials/android').json()) as any).data?.credentials || [];
  }
  public async getAllCredentialsForAppApi(projectFullName: string): Promise<AndroidCredentials> {
    return ((await apiClient.get(`credentials/android/${projectFullName}`).json()) as any)?.data;
  }
  public async updateKeystoreApi(projectFullName: string, keystore: Keystore): Promise<void> {
    await apiClient.put(`credentials/android/keystore/${projectFullName}`, {
      json: {
        keystore,
      },
    });
  }
  public async updateFcmKeyApi(projectFullName: string, fcmApiKey: string): Promise<void> {
    await apiClient.put(`credentials/android/push/${projectFullName}`, { json: { fcmApiKey } });
  }
  public async removeKeystoreApi(projectFullName: string): Promise<void> {
    await apiClient.delete(`credentials/android/keystore/${projectFullName}`);
  }
  public async removeFcmKeyApi(projectFullName: string): Promise<void> {
    await apiClient.delete(`credentials/android/push/${projectFullName}`);
  }
}
