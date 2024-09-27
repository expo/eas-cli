import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';
import { Analytics } from '../../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { selectPlatformAsync } from '../../platform';
import { Actor } from '../../user/User';
import { Client } from '../../vcs/vcs';
import { CredentialsContextProjectInfo } from '../context';

export class SelectPlatform {
  constructor(
    public readonly actor: Actor,
    public readonly graphqlClient: ExpoGraphqlClient,
    public readonly vcsClient: Client,
    public readonly analytics: Analytics,
    public readonly projectInfo: CredentialsContextProjectInfo | null,
    public readonly getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn,
    private readonly flagPlatform?: string
  ) {}

  async runAsync(): Promise<void> {
    const platform = await selectPlatformAsync(this.flagPlatform);

    if (platform === 'ios') {
      await new ManageIos(this, process.cwd()).runAsync();
      return;
    }
    await new ManageAndroid(this, process.cwd()).runAsync();
  }
}
