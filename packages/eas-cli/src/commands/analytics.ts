import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import UserSettings from '../user/UserSettings';

export default class AnalyticsView extends EasCommand {
  static override description = 'display or change analytics settings';

  static override args = [{ name: 'STATUS', options: ['on', 'off'] }];

  async runAsync(): Promise<void> {
    const { STATUS: status } = (await this.parse(AnalyticsView)).args;
    if (status) {
      await UserSettings.setAsync('analyticsEnabled', status === 'on');
      Log.withTick(`${status === 'on' ? 'Enabling' : 'Disabling'} analytics.`);
    } else {
      const analyticsEnabled = await UserSettings.getAsync('analyticsEnabled', null);
      Log.log(
        `Analytics are ${
          analyticsEnabled === false ? 'disabled' : 'enabled'
        } on this eas-cli installation.`
      );
    }
  }
}
