import { CredentialsSource } from '@eas/config';
import { Platform } from '@expo/eas-build-job';

import log from '../../log';
import { runCredentialsManagerAsync } from '../CredentialsManager';
import { CredentialsProvider } from '../CredentialsProvider';
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

export default class AndroidCredentialsProvider implements CredentialsProvider {
  public readonly platform = Platform.Android;

  constructor(private ctx: Context, private app: AppLookupParams) {}

  private get projectFullName(): string {
    const { projectName, accountName } = this.app;
    return `@${accountName}/${projectName}`;
  }

  public async hasRemoteAsync(): Promise<boolean> {
    const keystore = await this.ctx.android.fetchKeystoreAsync(this.projectFullName);
    return !!keystore;
  }

  public async hasLocalAsync(): Promise<boolean> {
    if (!(await credentialsJsonReader.fileExistsAsync(this.ctx.projectDir))) {
      return false;
    }
    try {
      const rawCredentialsJson = await credentialsJsonReader.readRawAsync(this.ctx.projectDir);
      return !!rawCredentialsJson?.android;
    } catch (err) {
      log.error(err); // malformed json
      return false;
    }
  }

  public async isLocalSyncedAsync(): Promise<boolean> {
    try {
      const [remote, local] = await Promise.all([
        this.ctx.android.fetchKeystoreAsync(this.projectFullName),
        credentialsJsonReader.readAndroidCredentialsAsync(this.ctx.projectDir),
      ]);
      const r = remote;
      const l = local?.keystore;
      return !!(
        r &&
        l &&
        r.keystore === l.keystore &&
        r.keystorePassword === l.keystorePassword &&
        r.keyAlias === l.keyAlias &&
        r.keyPassword === l.keyPassword
      );
    } catch (_) {
      return false;
    }
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
      throw new Error('Unable to set up credentials, failed to fetch keystore from Expo servers');
    }
    return { keystore };
  }

  private async getLocalAsync(): Promise<AndroidCredentials> {
    return await credentialsJsonReader.readAndroidCredentialsAsync(this.ctx.projectDir);
  }
}
