import { Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import * as credentialsJsonReader from '../credentialsJson/read';
import { SetupBuildCredentials } from './actions/SetupBuildCredentials';
import { Keystore } from './credentials';

export interface AndroidCredentials {
  keystore: Keystore;
}

interface AppLookupParams {
  projectName: string;
  accountName: string;
}

interface Options {
  app: AppLookupParams;
  skipCredentialsCheck?: boolean;
}

export default class AndroidCredentialsProvider {
  public readonly platform = Platform.ANDROID;

  constructor(private ctx: Context, private options: Options) {}

  private get projectFullName(): string {
    const { projectName, accountName } = this.options.app;
    return `@${accountName}/${projectName}`;
  }

  public async getCredentialsAsync(
    src: CredentialsSource.LOCAL | CredentialsSource.REMOTE
  ): Promise<AndroidCredentials> {
    switch (src) {
      case CredentialsSource.LOCAL:
        return await this.getLocalAsync();
      case CredentialsSource.REMOTE:
        return await this.getRemoteAsync();
    }
  }

  private async getRemoteAsync(): Promise<AndroidCredentials> {
    await new CredentialsManager(this.ctx).runActionAsync(
      new SetupBuildCredentials(this.projectFullName)
    );
    const keystore = await this.ctx.android.fetchKeystoreAsync(this.projectFullName);
    if (!keystore) {
      throw new Error('Unable to set up credentials, failed to fetch keystore from EAS servers');
    }
    return { keystore };
  }

  private async getLocalAsync(): Promise<AndroidCredentials> {
    return await credentialsJsonReader.readAndroidCredentialsAsync(this.ctx.projectDir);
  }
}
