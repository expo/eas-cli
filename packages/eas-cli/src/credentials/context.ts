import { ExpoConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import { EasJson } from '@expo/eas-json';
import chalk from 'chalk';

import Log from '../log';
import { getExpoConfig } from '../project/expoConfig';
import { getProjectAccountName } from '../project/projectUtils';
import { confirmAsync } from '../prompts';
import { Actor, getActorDisplayName } from '../user/User';
import * as AndroidGraphqlClient from './android/api/GraphqlClient';
import * as IosGraphqlClient from './ios/api/GraphqlClient';
import AppStoreApi from './ios/appstore/AppStoreApi';
import { AuthenticationMode } from './ios/appstore/authenticateTypes';

export class CredentialsContext {
  public readonly android = AndroidGraphqlClient;
  public readonly appStore = new AppStoreApi();
  public readonly ios = IosGraphqlClient;
  public readonly nonInteractive: boolean;
  public readonly projectDir: string;
  public readonly user: Actor;
  public readonly easJsonCliConfig?: EasJson['cli'];

  private shouldAskAuthenticateAppStore: boolean = true;
  private resolvedExp?: ExpoConfig;

  constructor(
    private options: {
      exp?: ExpoConfig;
      easJsonCliConfig?: EasJson['cli'];
      nonInteractive?: boolean;
      projectDir: string;
      user: Actor;
      env?: Env;
    }
  ) {
    this.easJsonCliConfig = options.easJsonCliConfig;
    this.projectDir = options.projectDir;
    this.user = options.user;
    this.nonInteractive = options.nonInteractive ?? false;

    this.resolvedExp = options.exp;
    if (!this.resolvedExp) {
      this.resolvedExp =
        CredentialsContext.getExpoConfigInProject(this.projectDir, { env: options.env }) ??
        undefined;
    }
  }

  static getExpoConfigInProject(
    projectDir: string,
    { env }: { env?: Env } = {}
  ): ExpoConfig | null {
    try {
      return getExpoConfig(projectDir, { env });
    } catch {
      // ignore error, context might be created outside of expo project
      return null;
    }
  }

  get hasProjectContext(): boolean {
    return !!this.resolvedExp;
  }

  get exp(): ExpoConfig {
    this.ensureProjectContext();
    return this.resolvedExp!;
  }

  public ensureProjectContext(): void {
    if (this.hasProjectContext) {
      return;
    }
    // trigger getConfig error
    getExpoConfig(this.options.projectDir);
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

    if (this.appStore.defaultAuthenticationMode === AuthenticationMode.API_KEY) {
      await this.appStore.ensureAuthenticatedAsync();
      return;
    }

    Log.log(
      chalk.green(
        'If you provide your Apple account credentials we will be able to generate all necessary build credentials and fully validate them.'
      )
    );
    Log.log(
      chalk.green(
        'This is optional, but without Apple account access you will need to provide all the missing values manually and we can only run minimal validation on them.'
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
          'No problem! 👌 If any of the next steps will require Apple account access we will ask you again about it.'
        )
      );
    }
    this.shouldAskAuthenticateAppStore = false;
  }
}
