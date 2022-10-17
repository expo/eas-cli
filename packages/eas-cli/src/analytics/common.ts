import { Analytics, AnalyticsEvent, AnalyticsEventProperties } from './AnalyticsManager';

export async function withAnalyticsAsync<Result>(
  analytics: Analytics,
  fn: () => Promise<Result>,
  {
    attemptEvent,
    successEvent,
    failureEvent,
    properties,
  }: {
    attemptEvent: AnalyticsEvent;
    successEvent: AnalyticsEvent;
    failureEvent: AnalyticsEvent;
    properties: AnalyticsEventProperties;
  }
): Promise<Result> {
  try {
    analytics.logEvent(attemptEvent, properties);
    const result = await fn();
    analytics.logEvent(successEvent, properties);
    return result;
  } catch (error: any) {
    analytics.logEvent(failureEvent, {
      ...properties,
      reason: error.message,
    });
    throw error;
  }
}
