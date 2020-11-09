import { Platform } from '@expo/eas-build-job';

export interface CredentialsProvider {
  platform: Platform;
  hasRemoteAsync(): Promise<boolean>;
  hasLocalAsync(): Promise<boolean>;
  isLocalSyncedAsync(): Promise<boolean>;
}
