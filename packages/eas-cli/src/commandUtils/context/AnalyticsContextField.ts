import ContextField, { ContextOptions } from './ContextField';
import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';

export default class AnalyticsContextField extends ContextField<AnalyticsWithOrchestration> {
  async getValueAsync({ analytics }: ContextOptions): Promise<AnalyticsWithOrchestration> {
    return analytics;
  }
}
