import { Analytics } from '../../analytics/AnalyticsManager';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import SessionManager from '../../user/SessionManager';
import { Client } from '../../vcs/vcs';

export interface ContextOptions {
  sessionManager: SessionManager;
  analytics: Analytics;
  nonInteractive: boolean;
  vcsClientOverride?: Client;
  /**
   * If specified, env variables from the selected environment will be fetched from the server and used to evaluate the dynamic config.
   */
  withServerSideEnvironment?: EnvironmentVariableEnvironment | null;
}

export default abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}
