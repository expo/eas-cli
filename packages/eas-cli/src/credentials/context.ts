import { ExpoConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import { EasJson } from '@expo/eas-json';
import chalk from 'chalk';

import * as AndroidGraphqlClient from './android/api/GraphqlClient';
import * as IosGraphqlClient from './ios/api/GraphqlClient';
import AppStoreApi from './ios/appstore/AppStoreApi';
import { AuthenticationMode } from './ios/appstore/authenticateTypes';
import { Analytics } from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../log';
import { getPrivateExpoConfig } from '../project/expoConfig';
import { confirmAsync } from '../prompts';
import { Actor } from '../user/User';
import { Client } from '../vcs/vcs';

export type CredentialsContextProjectInfo = {
  exp: ExpoConfig;
  projectId: string;
};

export class CredentialsContext {
  public readonly android = AndroidGraphqlClient;
  public readonly appStore = new AppStoreApi();
  public readonly ios = IosGraphqlClient;
  public readonly nonInteractive: boolean;
  public readonly freezeCredentials: boolean = false;
  public readonly projectDir: string;
  public readonly user: Actor;
  public readonly graphqlClient: ExpoGraphqlClient;
  public readonly analytics: Analytics;
  public readonly vcsClient: Client;
  public readonly easJsonCliConfig?: EasJson['cli'];

  private shouldAskAuthenticateAppStore: boolean = true;

  private readonly projectInfo: CredentialsContextProjectInfo | null;

  constructor(
    private readonly options: {
      // if null, this implies not running in a project context
      projectInfo: CredentialsContextProjectInfo | null;
      easJsonCliConfig?: EasJson['cli'];
      nonInteractive: boolean;
      projectDir: string;
      user: Actor;
      graphqlClient: ExpoGraphqlClient;
      analytics: Analytics;
      vcsClient: Client;
      freezeCredentials?: boolean;
      env?: Env;
    }
  ) {
    this.easJsonCliConfig = options.easJsonCliConfig;
    this.projectDir = options.projectDir;
    this.user = options.user;
    this.graphqlClient = options.graphqlClient;
    this.analytics = options.analytics;
    this.vcsClient = options.vcsClient;
    this.nonInteractive = options.nonInteractive ?? false;
    this.projectInfo = options.projectInfo;
    this.freezeCredentials = options.freezeCredentials ?? false;
  }

  get hasProjectContext(): boolean {
    return !!this.projectInfo;
  }

  get exp(): ExpoConfig {
    this.ensureProjectContext();
    return this.projectInfo!.exp;
  }

  get projectId(): string {
    this.ensureProjectContext();
    return this.projectInfo!.projectId;
  }

  public ensureProjectContext(): void {
    if (this.hasProjectContext) {
      return;
    }
    // trigger getConfig error
    getPrivateExpoConfig(this.options.projectDir);
  }

  async bestEffortAppStoreAuthenticateAsync(): Promise<void> {
    if (!!this.appStore.authCtx || !this.shouldAskAuthenticateAppStore) {
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
