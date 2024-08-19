import { Analytics } from '../../analytics/AnalyticsManager';
import SessionManager from '../../user/SessionManager';
import { Client } from '../../vcs/vcs';

export interface ContextOptions {
  sessionManager: SessionManager;
  analytics: Analytics;
  nonInteractive: boolean;
  vcsClientOverride?: Client;
}

export default abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}
