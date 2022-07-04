import { Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { AndroidAppBuildCredentialsFragment } from '../../graphql/generated.js';
import { nullthrows } from '../../utils/nullthrows.js';
import { CredentialsContext } from '../context.js';
import * as credentialsJsonReader from '../credentialsJson/read.js';
import { SetUpBuildCredentials } from './actions/SetUpBuildCredentials.js';
import { AppLookupParams } from './api/GraphqlClient.js';
import { Keystore } from './credentials.js';

export interface AndroidCredentials {
  keystore: Keystore;
}

interface Options {
  app: AppLookupParams;
}

export default class AndroidCredentialsProvider {
  public readonly platform = Platform.ANDROID;

  constructor(private ctx: CredentialsContext, private options: Options) {}

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
    const setupBuildCredentialsAction = new SetUpBuildCredentials({ app: this.options.app });
    const buildCredentials = await setupBuildCredentialsAction.runAsync(this.ctx);
    return this.toAndroidCredentials(buildCredentials);
  }

  private toAndroidCredentials(
    androidBuildCredentials: AndroidAppBuildCredentialsFragment
  ): AndroidCredentials {
    return {
      keystore: {
        keystore: nullthrows(androidBuildCredentials.androidKeystore?.keystore),
        keystorePassword: nullthrows(androidBuildCredentials.androidKeystore?.keystorePassword),
        keyAlias: nullthrows(androidBuildCredentials.androidKeystore?.keyAlias),
        keyPassword: androidBuildCredentials.androidKeystore?.keyPassword ?? undefined,
      },
    };
  }

  private async getLocalAsync(): Promise<AndroidCredentials> {
    return await credentialsJsonReader.readAndroidCredentialsAsync(this.ctx.projectDir);
  }
}
