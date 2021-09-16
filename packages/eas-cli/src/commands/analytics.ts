import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import UserSettings from '../user/UserSettings';

export default class AnalyticsView extends EasCommand {
  static description = 'view or change analytics settings';

  static args = [{ name: 'STATUS', options: ['on', 'off'] }];

  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    const { STATUS: status } = this.parse(AnalyticsView).args;
    if (status) {
      await UserSettings.setAsync('amplitudeEnabled', status === 'on');
      Log.withTick(`${status === 'on' ? 'Enabling' : 'Disabling'} analytics.`);
    } else {
      const amplitudeEnabled = await UserSettings.getAsync('amplitudeEnabled', null);
      Log.log(
        `Analytics are ${
          amplitudeEnabled === false ? 'disabled' : 'enabled'
        } on this eas-cli installation.`
      );
    }
  }
}
