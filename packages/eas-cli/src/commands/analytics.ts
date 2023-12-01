import { Args } from '@oclif/core';

import { getAnalyticsEnabledAsync, setAnalyticsEnabledAsync } from '../analytics/AnalyticsManager';
import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';

export default class AnalyticsView extends EasCommand {
  static override description = 'display or change analytics settings';

  static override args = { STATUS: Args.string({ options: ['on', 'off'] }) };

  async runAsync(): Promise<void> {
    const { STATUS: status } = (await this.parse(AnalyticsView)).args;
    if (status) {
      setAnalyticsEnabledAsync(status === 'on');
      Log.withTick(`${status === 'on' ? 'Enabling' : 'Disabling'} analytics.`);
    } else {
      const analyticsEnabled = await getAnalyticsEnabledAsync();
      Log.log(
        `Analytics are ${!analyticsEnabled ? 'disabled' : 'enabled'} on this eas-cli installation.`
      );
    }
  }
}
