import { Command } from '@oclif/command';

import { AnalyticsEvent, flushAsync, initAsync, logEvent } from '../analytics';
import { getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';

export default abstract class EasCommand extends Command {
  /**
   * When user data is unavailable locally, determines if the command will
   * request it from the backend
   * @returns boolean - if authentication is required
   */
  requiresAuthentication(): boolean {
    return true;
  }

  async init() {
    await initAsync();
    if (this.requiresAuthentication()) {
      await ensureLoggedInAsync();
    } else {
      await getUserAsync();
    }
    logEvent(AnalyticsEvent.ACTION, {
      action: `eas ${this.id}`,
    });
  }

  async catch(err: Error) {
    return super.catch(err);
  }

  async finally(err: Error) {
    await flushAsync();
    return super.finally(err);
  }
}
