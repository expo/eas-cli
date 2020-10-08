import { ExpoConfig, getConfig } from '@expo/config';
import pick from 'lodash/pick';

import log from '../log';
import { User } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import AndroidApi from './android/api/Client';
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
  readonly user: User;
  readonly nonInteractive: boolean;
  readonly android: AndroidApi;
  readonly hasProjectContext: boolean;
  readonly exp: ExpoConfig;

  ensureProjectContext(): void;
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
  public readonly appStore: AppStoreApi;
  public readonly nonInteractive: boolean;

  constructor(
    public readonly projectDir: string,
    public readonly user: User,
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
      // Figure out if User A is configuring credentials as admin for User B's project
      const isProxyUser = this.exp.owner && this.exp.owner !== this.user.username;
      log(
        `Accessing credentials ${isProxyUser ? 'on behalf of' : 'for'} ${
          this.exp.owner ?? this.user.username
        } in project ${this.exp.slug}`
      );
    } else {
      log(`Accessing credentials for ${this.exp.owner ?? this.user.username}`);
    }
  }
}
