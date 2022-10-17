import { Analytics, AnalyticsEvent } from './AnalyticsManager';

export type TrackingContext = Record<string, string | number | boolean>;

export async function withAnalyticsAsync<Result>(
  analytics: Analytics,
  fn: () => Promise<Result>,
  {
    successEvent,
    failureEvent,
    trackingCtx,
  }: {
    attemptEvent: AnalyticsEvent;
    successEvent: AnalyticsEvent;
    failureEvent: AnalyticsEvent;
    trackingCtx: TrackingContext;
  }
): Promise<Result> {
  try {
    const result = await fn();
    analytics.logEvent(successEvent, trackingCtx);
    return result;
  } catch (error: any) {
    analytics.logEvent(failureEvent, {
      ...trackingCtx,
      reason: error.message,
    });
    throw error;
  }
}
