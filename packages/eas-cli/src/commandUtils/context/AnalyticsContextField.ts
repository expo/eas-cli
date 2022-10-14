import { IAnalyticsManager } from '../../analytics/AnalyticsManager';
import ContextField, { ContextOptions } from './ContextField';

export default class AnalyticsContextField extends ContextField<IAnalyticsManager> {
  async getValueAsync({ analyticsManager }: ContextOptions): Promise<IAnalyticsManager> {
    return analyticsManager;
  }
}
