import { Command } from '@oclif/command';

import { flushAsync, initAsync } from '../../analytics';
import { ensureLoggedInAsync } from '../../user/actions';

export default abstract class AuthorizedCommand extends Command {
  async init() {
    await initAsync();
    await ensureLoggedInAsync();
  }
  async catch(err: Error) {
    return super.catch(err);
  }
  async finally(err: Error) {
    await flushAsync();
    return super.finally(err);
  }
}
