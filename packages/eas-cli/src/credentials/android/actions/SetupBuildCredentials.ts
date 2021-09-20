import nullthrows from 'nullthrows';

import {
  AndroidAppBuildCredentialsFragment,
  AndroidKeystoreFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { Context } from '../../context';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { AppLookupParams } from '../api/GraphqlClient';
import {
  canCopyLegacyCredentialsAsync,
  createOrUpdateDefaultAndroidAppBuildCredentialsAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from './BuildCredentialsUtils';
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

    if (!ctx.nonInteractive) {
      const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(ctx, app);
      if (canCopyLegacyCredentials) {
        await promptUserAndCopyLegacyCredentialsAsync(ctx, app);
      }
    }

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
      return await ctx.android.createOrUpdateAndroidAppBuildCredentialsByNameAsync(app, name, {
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

    const defaultBuildCredentials = await ctx.android.getDefaultAndroidAppBuildCredentialsAsync(
      app
    );
    const defaultKeystore = defaultBuildCredentials?.androidKeystore ?? null;
    if (defaultKeystore) {
      ora(
        `Using Keystore from configuration: ${nullthrows(defaultBuildCredentials).name} (default)`
      ).succeed();
      return defaultBuildCredentials;
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
    const maybeBuildCredentials = await ctx.android.getAndroidAppBuildCredentialsByNameAsync(
      app,
      name
    );
    const keystore = maybeBuildCredentials?.androidKeystore ?? null;
    if (keystore) {
      const buildCredentials = nullthrows(maybeBuildCredentials);
      ora(
        `Using Keystore from configuration: ${buildCredentials.name}${
          buildCredentials.isDefault ? ' (default)' : ''
        }`
      ).succeed();
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
