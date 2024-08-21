import { getAnalyticsEnabledAsync, setAnalyticsEnabledAsync } from '../analytics/AnalyticsManager';
import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';

export default class AnalyticsView extends EasCommand {
  static override description = 'display or change analytics settings';

  static override args = [{ name: 'STATUS', options: ['on', 'off'] }];

  async runAsync(): Promise<void> {
    const { STATUS: status } = (await this.parse(AnalyticsView)).args;
    if (status) {
      await setAnalyticsEnabledAsync(status === 'on');
      Log.withTick(`${status === 'on' ? 'Enabling' : 'Disabling'} analytics.`);
    } else {
      const analyticsEnabled = await getAnalyticsEnabledAsync();
      Log.log(
        `Analytics are ${
          analyticsEnabled === false ? 'disabled' : 'enabled'
        } on this eas-cli installation.`
      );
    }
  }
}
