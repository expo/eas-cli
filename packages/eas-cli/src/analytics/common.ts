import { AnalyticsEvent, IAnalyticsManager } from './AnalyticsManager';

export type TrackingContext = Record<string, string | number | boolean>;

export async function withAnalyticsAsync<Result>(
  analyticsManager: IAnalyticsManager,
  fn: () => Promise<Result>,
  analytics: {
    attemptEvent: AnalyticsEvent;
    successEvent: AnalyticsEvent;
    failureEvent: AnalyticsEvent;
    trackingCtx: TrackingContext;
  }
): Promise<Result> {
  try {
    const result = await fn();
    analyticsManager.logEvent(analytics.successEvent, analytics.trackingCtx);
    return result;
  } catch (error: any) {
    analyticsManager.logEvent(analytics.failureEvent, {
      ...analytics.trackingCtx,
      reason: error.message,
    });
    throw error;
  }
}
