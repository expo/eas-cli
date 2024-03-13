import { Platform } from '@expo/eas-build-job';

import { Analytics } from '../../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Actor } from '../../user/User';
import { Client } from '../../vcs/vcs';
import { CredentialsContextProjectInfo } from '../context';
import { SetUpAndroidBuildCredentials } from '../manager/SetUpAndroidBuildCredentials';
import { SetUpIosBuildCredentials } from '../manager/SetUpIosBuildCredentials';

export class SetUpBuildCredentialsCommandAction {
  constructor(
    public readonly actor: Actor,
    public readonly graphqlClient: ExpoGraphqlClient,
    public readonly vcsClient: Client,
    public readonly analytics: Analytics,
    public readonly projectInfo: CredentialsContextProjectInfo | null,
    public readonly getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn,
    private readonly platform: Platform,
    private readonly profileName: string
  ) {}

  async runAsync(): Promise<void> {
    // TODO: add an option for "all" which logs before running each platform action

    if (this.platform === Platform.IOS) {
      return await new SetUpIosBuildCredentials(this, process.cwd(), this.profileName).runAsync();
    }
    return await new SetUpAndroidBuildCredentials(this, process.cwd(), this.profileName).runAsync();
  }
}
