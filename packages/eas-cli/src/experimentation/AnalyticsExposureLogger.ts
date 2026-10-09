import type { ExposureData, ExposureLogger } from '@expo/experimentation';

import { Analytics, ExperimentationEvent } from '../analytics/AnalyticsManager';

export class AnalyticsExposureLogger implements ExposureLogger<Record<string, any>> {
  constructor(private readonly analytics: Analytics) {}

  public logExposure(data: ExposureData<Record<string, any>>): void {
    const { variant } = data.params;
    this.analytics.logEvent(ExperimentationEvent.EXPERIMENT_VIEWED, {
      experimentName: data.name,
      // Analytics properties cannot be undefined. Fall back to all params when there is no variant.
      variationName: variant !== undefined ? String(variant) : JSON.stringify(data.params),
      // The unit is always a single value (actor ID, account ID, or device ID).
      unit: String(data.unit[0]),
    });
  }
}
