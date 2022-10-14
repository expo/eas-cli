import { IAnalyticsManager } from '../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { Actor } from '../../user/User';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';

export interface Action<T = void> {
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analyticsManager: IAnalyticsManager;
  projectInfo: CredentialsContextProjectInfo | null;
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
