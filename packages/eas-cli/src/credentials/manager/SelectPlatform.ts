import { Analytics } from '../../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { selectPlatformAsync } from '../../platform';
import { Actor } from '../../user/User';
import { CredentialsContextProjectInfo } from '../context';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

export class SelectPlatform {
  constructor(
    public readonly actor: Actor,
    public readonly graphqlClient: ExpoGraphqlClient,
    public readonly analytics: Analytics,
    public readonly projectInfo: CredentialsContextProjectInfo | null,
    public readonly getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn,
    private readonly flagPlatform?: string
  ) {}

  async runAsync(): Promise<void> {
    const platform = await selectPlatformAsync(this.flagPlatform);

    if (platform === 'ios') {
      return await new ManageIos(this, process.cwd()).runAsync();
    }
    return await new ManageAndroid(this, process.cwd()).runAsync();
  }
}
