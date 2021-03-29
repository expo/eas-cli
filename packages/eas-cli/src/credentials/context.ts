import { ExpoConfig, getConfig } from '@expo/config';
import chalk from 'chalk';
import pick from 'lodash/pick';

import Log from '../log';
import { getProjectAccountName } from '../project/projectUtils';
import { confirmAsync } from '../prompts';
import { Actor, getActorDisplayName } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import AndroidApi from './android/api/Client';
import iOSApi from './ios/api/Client';
import * as IosGraphqlClient from './ios/api/GraphqlClient';
import AppStoreApi from './ios/appstore/AppStoreApi';

interface AppleCtxOptions {
  appleId?: string;
  appleIdPassword?: string;
  teamId?: string;
}

interface Options extends AppleCtxOptions {
  nonInteractive?: boolean;
}

export interface Context {
  readonly projectDir: string;
  readonly user: Actor;
  readonly nonInteractive: boolean;
  readonly android: AndroidApi;
  readonly ios: iOSApi;
  readonly newIos: typeof IosGraphqlClient;
  readonly appStore: AppStoreApi;
  readonly hasProjectContext: boolean;
  readonly exp: ExpoConfig;

  ensureProjectContext(): void;
  bestEffortAppStoreAuthenticateAsync(): Promise<void>;
}

export async function createCredentialsContextAsync(
  projectDir: string,
  options: Options
): Promise<Context> {
  const user = await ensureLoggedInAsync();

  let expoConfig: ExpoConfig | undefined;
  try {
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    expoConfig = exp;
  } catch (error) {
    // ignore error, context might be created outside of expo project
  }

  return new CredentialsContext(projectDir, user, expoConfig, options);
}

class CredentialsContext implements Context {
  public readonly android = new AndroidApi();
  public readonly ios = new iOSApi();
  public readonly newIos = IosGraphqlClient;
  public readonly appStore: AppStoreApi;
  public readonly nonInteractive: boolean;
  private shouldAskAuthenticateAppStore: boolean = true;

  constructor(
    public readonly projectDir: string,
    public readonly user: Actor,
    private _exp: ExpoConfig | undefined,
    options: Options
  ) {
    this.appStore = new AppStoreApi(pick(options, ['appleId', 'appleIdPassword', 'teamId']));
    this.nonInteractive = options.nonInteractive ?? false;
  }

  get hasProjectContext(): boolean {
    return !!this._exp;
  }

  get exp(): ExpoConfig {
    this.ensureProjectContext();
    return this._exp!;
  }

  public ensureProjectContext() {
    if (this.hasProjectContext) {
      return;
    }
    // trigger getConfig error
    getConfig(this.projectDir, { skipSDKVersionRequirement: true });
  }

  public logOwnerAndProject() {
    if (this.hasProjectContext) {
      const owner = getProjectAccountName(this.exp, this.user);
      // Figure out if User A is configuring credentials as admin for User B's project
      const isProxyUser = this.user.__typename === 'Robot' || owner !== this.user.username;

      Log.log(
        `Accessing credentials ${isProxyUser ? 'on behalf of' : 'for'} ${owner} in project ${
          this.exp.slug
        }`
      );
    } else {
      Log.log(`Accessing credentials for ${this.exp.owner ?? getActorDisplayName(this.user)}`);
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
