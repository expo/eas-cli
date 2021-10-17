import log from '../log';
import GitClient from './clients/gitNoCommit';
import NoVcsClient from './clients/noVcs';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

function resolveVcsClient(): Client {
  if (process.env.EAS_NO_VCS) {
    if (process.env.NODE_ENV !== 'test') {
      log.warn(NO_VCS_WARNING);
    }
    return new NoVcsClient();
  }
  return new GitClient();
}

export default resolveVcsClient();
