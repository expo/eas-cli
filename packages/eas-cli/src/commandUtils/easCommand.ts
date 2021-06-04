import { Command } from '@oclif/command';

import * as Analytics from '../analytics';
import { getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';

export default abstract class EasCommand extends Command {
  /**
   * When user data is unavailable locally, determines if the command will
   * force the user to log in
   */
  requiresAuthentication = true;

  async init() {
    await Analytics.initAsync();

    if (this.requiresAuthentication) {
      await ensureLoggedInAsync();
    } else {
      await getUserAsync();
    }
    Analytics.logEvent(Analytics.AnalyticsEvent.ACTION, {
      action: `eas ${this.id}`,
    });
  }

  async finally(err: Error) {
    await Analytics.flushAsync();
    return super.finally(err);
  }
}
