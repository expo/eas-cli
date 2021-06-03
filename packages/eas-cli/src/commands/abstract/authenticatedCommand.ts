import { Command } from '@oclif/command';

import { AnalyticsEvent, flushAsync, initAsync, logEvent } from '../../analytics';
import { ensureLoggedInAsync } from '../../user/actions';

export default abstract class AuthenticatedCommand extends Command {
  async init() {
    await initAsync();
    await ensureLoggedInAsync();
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
