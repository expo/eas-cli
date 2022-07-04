import { Analytics, Event } from './events.js';

export type TrackingContext = Record<string, string | number | boolean>;

export async function withAnalyticsAsync<Result>(
  fn: () => Promise<Result>,
  analytics: {
    attemptEvent: Event;
    successEvent: Event;
    failureEvent: Event;
    trackingCtx: TrackingContext;
  }
): Promise<Result> {
  try {
    const result = await fn();
    Analytics.logEvent(analytics.successEvent, analytics.trackingCtx);
    return result;
  } catch (error: any) {
    Analytics.logEvent(analytics.failureEvent, {
      ...analytics.trackingCtx,
      reason: error.message,
    });
    throw error;
  }
}
