import { Analytics } from '../../analytics/AnalyticsManager';
import ContextField, { ContextOptions } from './ContextField';

export default class AnalyticsContextField extends ContextField<Analytics> {
  async getValueAsync({ analytics }: ContextOptions): Promise<Analytics> {
    return analytics;
  }
}
