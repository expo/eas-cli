import log from '../log';
import GitClient from './git';
import LocalClient from './local';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

function resolveVcsClient(): Client {
  if (process.env.EAS_NO_VCS) {
    if (process.env.NODE_ENV !== 'test') {
      log.warn(NO_VCS_WARNING);
    }
    return new LocalClient();
  }
  return new GitClient();
}

export default resolveVcsClient();
