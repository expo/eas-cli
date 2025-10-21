import { EasService, EasServiceMetric, EstimatedUsage } from '../../graphql/generated';

export const THRESHOLD_PERCENT = 85;

export interface OverageThreshold {
  service: EasService;
  printedMetric: string;
  percentUsed: number;
}

export function calculatePercentUsed(value: number, limit: number): number {
  if (limit === 0) {
    return 0;
  }
  return Math.min(Math.floor((value / limit) * 100), 100);
}

export function calculateBuildThresholds({
  planMetrics,
}: {
  planMetrics: EstimatedUsage[];
}): OverageThreshold | null {
  const buildsPlanMetric = planMetrics[0];
  if (!buildsPlanMetric) {
    return null;
  }
  const percentUsed = calculatePercentUsed(buildsPlanMetric.value, buildsPlanMetric.limit);
  if (percentUsed >= THRESHOLD_PERCENT) {
    return {
      service: EasService.Builds,
      printedMetric: 'included build credits',
      percentUsed,
    };
  }
  return null;
}

export function calculateUpdatesThresholds({
  planMetrics,
}: {
  planMetrics: Pick<EstimatedUsage, 'serviceMetric' | 'value' | 'limit'>[];
}): OverageThreshold | null {
  const uniqueUpdaters = planMetrics.find(
    metric => metric.serviceMetric === EasServiceMetric.UniqueUpdaters
  );
  if (!uniqueUpdaters) {
    return null;
  }
  const percentUsed = calculatePercentUsed(uniqueUpdaters.value, uniqueUpdaters.limit);
  if (percentUsed >= THRESHOLD_PERCENT) {
    return {
      service: EasService.Updates,
      printedMetric: 'included updates MAU',
      percentUsed,
    };
  }
  return null;
}
