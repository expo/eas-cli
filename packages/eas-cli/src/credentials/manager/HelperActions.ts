import { Analytics } from '../../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { Actor } from '../../user/User';
import { Client } from '../../vcs/vcs';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';

export interface Action<T = void> {
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  vcsClient: Client;
  projectInfo: CredentialsContextProjectInfo | null;
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn;
  runAsync(ctx: CredentialsContext): Promise<T>;
}

export class PressAnyKeyToContinue {
  public async runAsync(): Promise<void> {
    Log.log('Press any key to continue...');
    await pressAnyKeyToContinueAsync();
    Log.newLine();
    Log.newLine();
  }
}
