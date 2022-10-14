import { IAnalyticsManager } from '../../analytics/AnalyticsManager';
import SessionManager from '../../user/SessionManager';

export interface ContextOptions {
  sessionManager: SessionManager;
  analyticsManager: IAnalyticsManager;
  nonInteractive: boolean;
}

export default abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}
