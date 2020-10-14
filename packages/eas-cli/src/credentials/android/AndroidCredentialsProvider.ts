import { CredentialsSource } from '@eas/config';
import { Platform } from '@expo/eas-build-job';

import { runCredentialsManagerAsync } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
import { Context } from '../context';
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
  nonInteractive: boolean;
}

export default class AndroidCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.Android;

  constructor(private ctx: Context, private app: AppLookupParams, options: Options) {}

  private get projectFullName(): string {
    const { projectName, accountName } = this.app;
    return `@${accountName}/${projectName}`;
  }

  public async hasRemoteAsync(): Promise<boolean> {
    const keystore = await this.ctx.android.fetchKeystoreAsync(this.projectFullName);
    return !!keystore;
  }

  public async hasLocalAsync(): Promise<boolean> {
    return false; // TODO
  }

  public async isLocalSyncedAsync(): Promise<boolean> {
    return false;
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
    throw new Error('Unknown');
  }

  private async getRemoteAsync(): Promise<AndroidCredentials> {
    await runCredentialsManagerAsync(this.ctx, new SetupBuildCredentials(this.projectFullName));
    const keystore = await this.ctx.android.fetchKeystoreAsync(this.projectFullName);
    if (!keystore) {
      throw new Error('Unable to set up credentials');
    }
    return { keystore };
  }

  private async getLocalAsync(): Promise<AndroidCredentials> {
    throw new Error('not implemented');
  }
}
