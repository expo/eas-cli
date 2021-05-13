import nullthrows from 'nullthrows';

import {
  AndroidAppBuildCredentialsFragment,
  AndroidKeystoreFragment,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { Context } from '../../../context';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { AppLookupParams } from '../../api/GraphqlClient';
import { createOrUpdateDefaultAndroidAppBuildCredentialsAsync } from '../BuildCredentialsUtils';
import { CreateKeystore } from './CreateKeystore';

interface Options {
  app: AppLookupParams;
  name?: string;
}

/**
 * Sets up Build Credentials for Android
 * @name: sets up build credentials for the specified configuration. If no name is specified, the default configuration is setup
 */
export class SetupBuildCredentials {
  constructor(private options: Options) {}

  async runAsync(ctx: Context): Promise<AndroidAppBuildCredentialsFragment> {
    const { app, name: maybeName } = this.options;
    const alreadySetupBuildCredentials = await this.getFullySetupBuildCredentialsAsync({
      ctx,
      app,
      name: maybeName,
    });
    if (alreadySetupBuildCredentials) {
      return alreadySetupBuildCredentials;
    }
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'Generating a new Keystore is not supported in --non-interactive mode'
      );
    }

    const keystore = await new CreateKeystore(app.account).runAsync(ctx);
    return await this.assignBuildCredentialsAsync({ ctx, app, name: maybeName, keystore });
  }

  async assignBuildCredentialsAsync({
    ctx,
    app,
    name,
    keystore,
  }: {
    ctx: Context;
    app: AppLookupParams;
    name?: string;
    keystore: AndroidKeystoreFragment;
  }): Promise<AndroidAppBuildCredentialsFragment> {
    if (name) {
      return await ctx.newAndroid.createOrUpdateAndroidAppBuildCredentialsByNameAsync(app, name, {
        androidKeystoreId: keystore.id,
      });
    }
    return await createOrUpdateDefaultAndroidAppBuildCredentialsAsync(ctx, app, {
      androidKeystoreId: keystore.id,
    });
  }

  async getFullySetupBuildCredentialsAsync({
    ctx,
    app,
    name,
  }: {
    ctx: Context;
    app: AppLookupParams;
    name?: string;
  }): Promise<AndroidAppBuildCredentialsFragment | null> {
    if (name) {
      return await this.getFullySetupBuildCredentialsByNameAsync({ ctx, app, name });
    }

    const defaultBuildCredentials = await ctx.newAndroid.getDefaultAndroidAppBuildCredentialsAsync(
      app
    );
    const defaultKeystore = defaultBuildCredentials?.androidKeystore ?? null;
    if (defaultKeystore) {
      Log.log(
        `Using Keystore from configuration: ${nullthrows(defaultBuildCredentials).name} (default)`
      );
      return defaultBuildCredentials;
    }

    // fall back to legacy credentials if we cant find a default keystore
    const legacyBuildCredentials = await ctx.newAndroid.getLegacyAndroidAppBuildCredentialsAsync(
      app
    );
    const legacyKeystore = legacyBuildCredentials?.androidKeystore ?? null;
    if (legacyKeystore) {
      Log.log('Using Keystore ported from Expo Classic (expo-cli)');
      return legacyBuildCredentials;
    }
    return null;
  }

  async getFullySetupBuildCredentialsByNameAsync({
    ctx,
    app,
    name,
  }: {
    ctx: Context;
    app: AppLookupParams;
    name: string;
  }): Promise<AndroidAppBuildCredentialsFragment | null> {
    const maybeBuildCredentials = await ctx.newAndroid.getAndroidAppBuildCredentialsByNameAsync(
      app,
      name
    );
    const keystore = maybeBuildCredentials?.androidKeystore ?? null;
    if (keystore) {
      const buildCredentials = nullthrows(maybeBuildCredentials);
      Log.log(
        `Using Keystore from configuration: ${buildCredentials.name}${
          buildCredentials.isDefault ? ' (default)' : ''
        }`
      );
      return buildCredentials;
    }
    Log.log(
      `No Keystore found for configuration: ${name}${
        maybeBuildCredentials?.isDefault ? ' (default)' : ''
      }`
    );
    return null;
  }
}
