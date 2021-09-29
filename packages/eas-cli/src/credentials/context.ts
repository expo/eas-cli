import { ExpoConfig, getConfig } from '@expo/config';
import chalk from 'chalk';

import Log from '../log';
import { getExpoConfig } from '../project/expoConfig';
import { getProjectAccountName } from '../project/projectUtils';
import { confirmAsync } from '../prompts';
import { Actor, getActorDisplayName } from '../user/User';
import * as AndroidGraphqlClient from './android/api/GraphqlClient';
import * as IosGraphqlClient from './ios/api/GraphqlClient';
import AppStoreApi from './ios/appstore/AppStoreApi';

export class CredentialsContext {
  public readonly android = AndroidGraphqlClient;
  public readonly appStore = new AppStoreApi();
  public readonly ios = IosGraphqlClient;
  public readonly nonInteractive: boolean;
  public readonly projectDir: string;
  public readonly user: Actor;

  private shouldAskAuthenticateAppStore: boolean = true;
  private _exp?: ExpoConfig;

  constructor(
    private options: {
      exp?: ExpoConfig;
      nonInteractive?: boolean;
      projectDir: string;
      user: Actor;
    }
  ) {
    this.projectDir = options.projectDir;
    this.user = options.user;
    this.nonInteractive = options.nonInteractive ?? false;

    this._exp = options.exp;
    if (!this._exp) {
      try {
        this._exp = getExpoConfig(options.projectDir);
      } catch (error) {
        // ignore error, context might be created outside of expo project
      }
    }
  }

  get hasProjectContext(): boolean {
    return !!this._exp;
  }

  get exp(): ExpoConfig {
    this.ensureProjectContext();
    return this._exp!;
  }

  public ensureProjectContext(): void {
    if (this.hasProjectContext) {
      return;
    }
    // trigger getConfig error
    getConfig(this.options.projectDir, { skipSDKVersionRequirement: true });
  }

  public logOwnerAndProject(): void {
    const { user } = this.options;
    if (this.hasProjectContext) {
      const owner = getProjectAccountName(this.exp, user);
      // Figure out if User A is configuring credentials as admin for User B's project
      const isProxyUser = user.__typename === 'Robot' || owner !== user.username;

      Log.log(
        `Accessing credentials ${isProxyUser ? 'on behalf of' : 'for'} ${owner} in project ${
          this.exp.slug
        }`
      );
    } else {
      Log.log(`Accessing credentials for ${this.exp.owner ?? getActorDisplayName(user)}`);
    }
  }

  async bestEffortAppStoreAuthenticateAsync(): Promise<void> {
    if (this.appStore.authCtx || !this.shouldAskAuthenticateAppStore) {
      // skip prompts if already have apple ctx or already asked about it
      return;
    }

    if (this.nonInteractive) {
      return;
    }

    Log.log(
      chalk.green(
        'If you provide your Apple account credentials we will be able to generate all necessary build credentials and fully validate them.'
      )
    );
    Log.log(
      chalk.green(
        'This is optional, but without Apple account access you will need to provide all the values manually and we can only run minimal validation on them.'
      )
    );
    const confirm = await confirmAsync({
      message: `Do you want to log in to your Apple account?`,
    });
    if (confirm) {
      await this.appStore.ensureAuthenticatedAsync();
    } else {
      Log.log(
        chalk.green(
          'No problem! 👌 If you select an action that requires those credentials we will ask you again about it.'
        )
      );
    }
    this.shouldAskAuthenticateAppStore = false;
  }
}
