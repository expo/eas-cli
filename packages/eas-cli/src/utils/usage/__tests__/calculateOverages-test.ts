import {
  EasService,
  EasServiceMetric,
  EstimatedUsage,
  UsageMetricType,
} from '../../../graphql/generated';
import {
  THRESHOLD_PERCENT,
  calculateBuildThresholds,
  calculatePercentUsed,
  calculateUpdatesThresholds,
} from '../calculateOverages';

describe('calculatePercentUsed', () => {
  it('calculates percentage correctly', () => {
    expect(calculatePercentUsed(85, 100)).toBe(85);
    expect(calculatePercentUsed(50, 100)).toBe(50);
    expect(calculatePercentUsed(10, 100)).toBe(10);
  });

  it('floors the percentage', () => {
    expect(calculatePercentUsed(85.9, 100)).toBe(85);
    expect(calculatePercentUsed(50.5, 100)).toBe(50);
  });

  it('caps at 100%', () => {
    expect(calculatePercentUsed(150, 100)).toBe(100);
    expect(calculatePercentUsed(200, 100)).toBe(100);
  });

  it('handles zero limit', () => {
    expect(calculatePercentUsed(50, 0)).toBe(0);
  });

  it('handles zero value', () => {
    expect(calculatePercentUsed(0, 100)).toBe(0);
  });
});

describe('calculateBuildThresholds', () => {
  const createBuildPlanMetric = (value: number, limit: number): EstimatedUsage => ({
    id: 'test-id',
    service: EasService.Builds,
    serviceMetric: EasServiceMetric.Builds,
    metricType: UsageMetricType.Build,
    value,
    limit,
  });

  it('returns null when no plan metrics', () => {
    const result = calculateBuildThresholds({ planMetrics: [] });
    expect(result).toBeNull();
  });

  it('returns null when usage is below threshold', () => {
    const planMetrics = [createBuildPlanMetric(50, 100)];
    const result = calculateBuildThresholds({ planMetrics });
    expect(result).toBeNull();
  });

  it('returns threshold when usage is at threshold', () => {
    const planMetrics = [createBuildPlanMetric(85, 100)];
    const result = calculateBuildThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Builds,
      printedMetric: 'included build credits',
      percentUsed: 85,
    });
  });

  it('returns threshold when usage is above threshold', () => {
    const planMetrics = [createBuildPlanMetric(95, 100)];
    const result = calculateBuildThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Builds,
      printedMetric: 'included build credits',
      percentUsed: 95,
    });
  });

  it('returns threshold when usage is at 100%', () => {
    const planMetrics = [createBuildPlanMetric(100, 100)];
    const result = calculateBuildThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Builds,
      printedMetric: 'included build credits',
      percentUsed: 100,
    });
  });
});

describe('calculateUpdatesThresholds', () => {
  const createUpdatesPlanMetric = (
    serviceMetric: EasServiceMetric,
    value: number,
    limit: number
  ): Pick<EstimatedUsage, 'serviceMetric' | 'value' | 'limit'> => ({
    serviceMetric,
    value,
    limit,
  });

  it('returns null when no plan metrics', () => {
    const result = calculateUpdatesThresholds({ planMetrics: [] });
    expect(result).toBeNull();
  });

  it('returns null when UniqueUpdaters metric is not present', () => {
    const planMetrics = [
      createUpdatesPlanMetric(EasServiceMetric.ManifestRequests, 50, 100),
      createUpdatesPlanMetric(EasServiceMetric.AssetsRequests, 30, 100),
    ];
    const result = calculateUpdatesThresholds({ planMetrics });
    expect(result).toBeNull();
  });

  it('returns null when usage is below threshold', () => {
    const planMetrics = [
      createUpdatesPlanMetric(EasServiceMetric.UniqueUpdaters, 50, 100),
      createUpdatesPlanMetric(EasServiceMetric.ManifestRequests, 100, 1000),
    ];
    const result = calculateUpdatesThresholds({ planMetrics });
    expect(result).toBeNull();
  });

  it('returns threshold when usage is at threshold', () => {
    const planMetrics = [
      createUpdatesPlanMetric(EasServiceMetric.UniqueUpdaters, 85, 100),
      createUpdatesPlanMetric(EasServiceMetric.ManifestRequests, 100, 1000),
    ];
    const result = calculateUpdatesThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Updates,
      printedMetric: 'included updates MAU',
      percentUsed: 85,
    });
  });

  it('returns threshold when usage is above threshold', () => {
    const planMetrics = [
      createUpdatesPlanMetric(EasServiceMetric.UniqueUpdaters, 95, 100),
      createUpdatesPlanMetric(EasServiceMetric.ManifestRequests, 100, 1000),
    ];
    const result = calculateUpdatesThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Updates,
      printedMetric: 'included updates MAU',
      percentUsed: 95,
    });
  });

  it('returns threshold when usage is at 100%', () => {
    const planMetrics = [createUpdatesPlanMetric(EasServiceMetric.UniqueUpdaters, 1000, 1000)];
    const result = calculateUpdatesThresholds({ planMetrics });
    expect(result).toEqual({
      service: EasService.Updates,
      printedMetric: 'included updates MAU',
      percentUsed: 100,
    });
  });
});

describe('THRESHOLD_PERCENT', () => {
  it('is set to 85', () => {
    expect(THRESHOLD_PERCENT).toBe(85);
  });
});
